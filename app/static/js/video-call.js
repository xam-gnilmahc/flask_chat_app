/**
 * VIDEO CALL MODULE — WebRTC 1:1 Video/Audio Calling
 *
 * HOW IT WORKS (Simple Overview):
 * ───────────────────────────────
 * - Device A (Caller) clicks the call button → sends an SDP Offer to Device B via Socket.IO
 * - Device B (Callee) sees an "Incoming Call" popup → clicks Accept → sends an SDP Answer back
 * - Both devices exchange ICE candidates (network routing info) through the server
 * - Once ICE exchange is complete, a DIRECT peer-to-peer connection is established
 * - Video and audio stream DIRECTLY between Device A and Device B (no server involvement)
 * - The server is only used for signaling (initial handshake), NOT for streaming
 *
 * SIGNALING FLOW (through Flask-SocketIO server):
 * ────────────────────────────────────────────────
 *   Device A                    Server                    Device B
 *     │                          │                          │
 *     │── call_offer (SDP) ─────>│── call_offer (SDP) ────>│
 *     │                          │                          │
 *     │<── call_answer (SDP) ────│<── call_answer (SDP) ───│
 *     │                          │                          │
 *     │── ice_candidate ────────>│── ice_candidate ───────>│
 *     │<── ice_candidate ────────│<── ice_candidate ───────│
 *     │                          │                          │
 *     │◀══════════ DIRECT P2P CONNECTION (video+audio) ════▶│
 *     │                          │                          │
 *     │── end_call ─────────────>│── call_ended ──────────>│
 *
 * KEY TERMS:
 * ──────────
 * - SDP (Session Description Protocol): Describes what media (video/audio) the device supports
 * - ICE (Interactive Connectivity Establishment): Network routing info to find the best path between peers
 * - STUN Server: Helps devices discover their public IP address (used for NAT traversal)
 * - RTCPeerConnection: Browser API that handles the direct P2P connection
 * - Tracks: Individual video or audio streams within a connection
 */

// ═══════════════════════════════════════════════════════════════════════════════
// STATE VARIABLES — Track the current call status
// ═══════════════════════════════════════════════════════════════════════════════

let pc = null;             // RTCPeerConnection object — the P2P connection to the other device
let localStream = null;    // Your camera + microphone stream (what YOU capture)
let remoteStream = null;   // The other device's camera + mic stream (what THEY send to you)
let callActive = false;    // Is a call currently in progress? true = yes
let callPeerId = null;     // The user ID of the device you're connected to in this call
let callTimer = null;      // Timer interval ID for the call duration display (MM:SS)
let callSeconds = 0;       // Total seconds elapsed in the current call
let incomingOffer = null;  // Stores the SDP offer from Device A when Device B receives an incoming call


// ═══════════════════════════════════════════════════════════════════════════════
// ICE SERVER CONFIGURATION — Helps devices find each other across the internet
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * STUN server used to discover each device's public IP address.
 *
 * WHY NEEDED:
 *   Most devices are behind a NAT (router/firewall) that hides their real IP.
 *   The STUN server helps Device A and Device B discover their public-facing IP
 *   so they can route packets to each other.
 *
 * NOTE: This only works for ~85-90% of networks. Devices behind symmetric NATs
 *       or strict firewalls will need a TURN server (not implemented here).
 */
const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }  // Google's free public STUN server
  ]
};


// ═══════════════════════════════════════════════════════════════════════════════
// UI HELPER FUNCTIONS — Enable/disable buttons, show/hide overlays
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Enables or disables the call button in the chat header.
 * Called by both Device A and Device B.
 *
 * @param {boolean} enabled - true = button is clickable, false = button is grayed out
 */
function enableCallButton(enabled) {
  document.getElementById("callBtn").disabled = !enabled;
}

/**
 * Checks if the active chat partner is online, then enables/disables the call button.
 * Called whenever online status updates arrive from the server.
 *
 * DEVICE A or DEVICE B: Whoever opens a chat checks if the OTHER user is online.
 * If the other user is offline, the call button stays disabled.
 */
function updateCallBtnOnline() {
  const user = (window.__allUsers || []).find(u => u.id === activeUserId);
  // Call button is enabled ONLY if:
  //   1. There's an active chat partner (activeUserId is set)
  //   2. That partner is online (user.is_online)
  //   3. We're not already in a call (!callActive)
  enableCallButton(!!(activeUserId && user && user.is_online && !callActive));
}


// ═══════════════════════════════════════════════════════════════════════════════
// LOCAL MEDIA STREAM — Capture your own camera + microphone
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Captures the device's camera and microphone.
 * Called by BOTH Device A (when initiating call) and Device B (when accepting call).
 *
 * WHAT HAPPENS:
 *   1. Browser shows a permission popup: "Allow camera and microphone?"
 *   2. If user clicks "Allow", browser captures video (720p @ 30fps) + audio
 *   3. The captured stream is assigned to the #localVideo element so YOU can see yourself
 *   4. The stream is stored in `localStream` so it can be sent to the other device later
 *
 * REQUIREMENTS:
 *   - Page must be served over HTTPS or localhost (browser security requirement)
 *   - Device must have a camera and microphone
 *   - User must grant permission when prompted
 */
async function startLocalStream() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: true,  // Capture microphone audio
    });

    // Show YOUR OWN camera feed in the small local video thumbnail
    document.getElementById("localVideo").srcObject = localStream;
  } catch (err) {
    alert("Camera / mic access denied. Make sure you're on HTTPS or localhost.");
    throw err;  // Re-throw so the calling function knows it failed
  }
}

/**
 * Stops all media tracks (camera + mic) and clears the local stream.
 * Called when ending a call or when a call fails to connect.
 *
 * WHAT HAPPENS:
 *   - Camera light turns off
 *   - Microphone stops capturing
 *   - The local stream reference is cleared from memory
 */
function stopLocalStream() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());  // Stop each track (video + audio)
    localStream = null;
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// PEER CONNECTION — The direct P2P link between Device A and Device B
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Creates the RTCPeerConnection — the core WebRTC object that manages the P2P connection.
 * Called by BOTH Device A (caller) and Device B (callee) after they have their local stream.
 *
 * WHAT HAPPENS:
 *   1. A new RTCPeerConnection is created with STUN server config
 *   2. ALL local tracks (video + audio) are added to the connection
 *      → This means both video AND voice will be sent to the other device
 *   3. Three event handlers are registered:
 *      a. ontrack           — Fires when the OTHER device's video/audio stream arrives
 *      b. onicecandidate    — Fires when a new network route (ICE candidate) is discovered
 *      c. onconnectionstatechange — Fires if the connection drops or fails
 */
function createPeerConnection() {
  // Create the P2P connection with STUN server for NAT traversal
  pc = new RTCPeerConnection(ICE_SERVERS);

  // Add ALL local tracks (video + audio) to the connection
  // These tracks will be sent to the other device once connected
  if (localStream) {
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }

  // ─── EVENT: Remote stream received ──────────────────────────────────────
  // Fires when the OTHER device's video/audio stream arrives over the P2P connection
  //
  // DEVICE A perspective: This fires when Device B's camera + mic stream arrives
  // DEVICE B perspective: This fires when Device A's camera + mic stream arrives
  pc.ontrack = (e) => {
    remoteStream = e.streams[0];
    // Display the OTHER device's video in the main video area
    // Audio also plays through this video element (both video + voice)
    document.getElementById("remoteVideo").srcObject = remoteStream;
  };

  // ─── EVENT: New ICE candidate discovered ────────────────────────────────
  // Fires when the browser discovers a new way to reach this device over the network.
  // Each candidate represents a potential network path (IP:port combination).
  //
  // WHAT HAPPENS:
  //   Device A discovers a candidate → sends it to Device B via server
  //   Device B discovers a candidate → sends it to Device A via server
  //   Both devices try all candidates to find the BEST path to connect
  pc.onicecandidate = (e) => {
    if (e.candidate && callPeerId) {
      // Send this ICE candidate to the other device through the signaling server
      socket.emit("ice_candidate", {
        to_user_id: callPeerId,    // Who to send it to
        candidate: e.candidate     // The ICE candidate data
      });
    }
  };

  // ─── EVENT: Connection state changed ────────────────────────────────────
  // Fires if the P2P connection changes state (connected, disconnected, failed, closed)
  //
  // If the connection drops (e.g., network issue, other device left), automatically end the call
  pc.onconnectionstatechange = () => {
    if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
      endCall();
    }
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// CALL TIMER — Displays call duration on screen (MM:SS)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Starts the call duration timer. Updates the displayed time every second.
 * Called by BOTH Device A and Device B when the call starts.
 *
 * NOTE: Timer starts immediately when the call offer is sent/accepted,
 *       NOT when the P2P connection is established. So it includes connection setup time.
 */
function startCallTimer() {
  callSeconds = 0;
  document.getElementById("callDuration").textContent = "00:00";
  callTimer = setInterval(() => {
    callSeconds++;
    const m = String(Math.floor(callSeconds / 60)).padStart(2, "0");
    const s = String(callSeconds % 60).padStart(2, "0");
    document.getElementById("callDuration").textContent = `${m}:${s}`;
  }, 1000);
}


// ═══════════════════════════════════════════════════════════════════════════════
// CALL OVERLAY UI — Shows/hides the full-screen video call interface
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Shows the full-screen call overlay with video feeds and controls.
 * Called by BOTH Device A and Device B when the call begins.
 *
 * WHAT THE USER SEES:
 *   - Full-screen dark overlay covers the chat
 *   - Remote video (other device) fills the screen
 *   - Local video (your camera) is a small thumbnail in the bottom-right
 *   - Call duration timer (MM:SS)
 *   - Red "End Call" button
 */
function showCallOverlay() {
  callActive = true;
  document.getElementById("callOverlay").classList.remove("hidden");
  document.getElementById("callRemoteName").textContent = activeUsername;
  enableCallButton(false);  // Disable call button while in a call
}

/**
 * Hides the call overlay and returns to the normal chat view.
 * Called when the call ends (either side hangs up).
 *
 * WHAT THE USER SEES:
 *   - Call overlay disappears
 *   - Normal chat interface returns
 *   - Call button is re-enabled (if the other user is still online)
 */
function hideCallOverlay() {
  callActive = false;
  document.getElementById("callOverlay").classList.add("hidden");
  enableCallButton(true);
  updateCallBtnOnline();  // Re-check if call button should be enabled
  if (callTimer) {
    clearInterval(callTimer);
    callTimer = null;
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// END CALL — Cleanup when a call ends
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Ends the current call and cleans up all resources.
 * Called by BOTH Device A and Device B (either side can hang up).
 *
 * WHAT HAPPENS:
 *   1. Close the RTCPeerConnection (sever the P2P link)
 *   2. Stop the local camera + mic
 *   3. Notify the OTHER device that the call has ended (via server)
 *   4. Hide the call overlay
 *   5. Clear both video elements
 *
 * NOTE: The "end_call" socket event is only sent if there was an active peer.
 *       This prevents sending an end signal when cleanup runs on BOTH sides.
 */
async function endCall() {
  // Step 1: Close the P2P connection
  if (pc) {
    pc.close();
    pc = null;
  }

  // Step 2: Stop camera + mic
  stopLocalStream();

  // Step 3: Tell the OTHER device that we're ending the call
  if (callPeerId && callActive) {
    socket.emit("end_call", { to_user_id: callPeerId });
  }

  // Step 4: Reset state and hide the UI
  callPeerId = null;
  hideCallOverlay();

  // Step 5: Clear video elements (remove frozen frames)
  document.getElementById("localVideo").srcObject = null;
  document.getElementById("remoteVideo").srcObject = null;
}


// ═══════════════════════════════════════════════════════════════════════════════
// BITRATE CONTROL — Limit video quality to prevent lag
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Modifies the SDP (Session Description Protocol) to cap video bitrate at 2500 kbps.
 *
 * WHY:
 *   Without a bitrate limit, WebRTC may try to send very high-quality video,
 *   which can cause lag, buffering, or connection drops on slower networks.
 *   Capping at 2500 kbps balances quality and reliability.
 *
 * HOW:
 *   SDP is a text-based format that describes media capabilities.
 *   This function inserts "b=AS:2500" after the video media line,
 *   telling the browser to limit video bitrate to 2500 kbps.
 *
 * Applied to BOTH the offer (Device A) and answer (Device B).
 */
function bumpBitrate(sdp) {
  return sdp.replace(/a=mid:video\r\n/g, 'a=mid:video\r\nb=AS:2500\r\n');
}


// ═══════════════════════════════════════════════════════════════════════════════
// DEVICE A — CALLER: Initiating an outgoing call
// ═══════════════════════════════════════════════════════════════════════════════
//
// FLOW:
//   1. Device A clicks the "Call" button
//   2. Device A captures its camera + mic
//   3. Device A creates an RTCPeerConnection
//   4. Device A creates an SDP Offer (says "I want to call you, here's what I support")
//   5. Device A sends the offer to Device B via the server
//   6. Device A shows the call overlay and starts the timer
//   7. Device A waits for Device B's SDP Answer
//   8. Device A and Device B exchange ICE candidates
//   9. P2P connection established → video + audio flows directly
// ═══════════════════════════════════════════════════════════════════════════════

document.getElementById("callBtn").addEventListener("click", async () => {
  if (!activeUserId) return;

  try {
    // Store the ID of the device we're calling
    callPeerId = activeUserId;

    // Step 1: Capture our camera + microphone
    await startLocalStream();

    // Step 2: Create the P2P connection and add our tracks
    createPeerConnection();

    // Step 3: Create an SDP Offer
    // This describes what video/audio formats Device A supports
    const offer = await pc.createOffer();

    // Step 4: Apply bitrate limit and set as local description
    // setLocalDescription triggers ICE gathering — the browser starts finding network paths
    await pc.setLocalDescription({ type: "offer", sdp: bumpBitrate(offer.sdp) });

    // Step 5: Send the SDP Offer to Device B through the signaling server
    // Server will forward this to Device B's socket(s)
    socket.emit("call_offer", { to_user_id: callPeerId, sdp: pc.localDescription });

    // Step 6: Show the call overlay and start the timer
    showCallOverlay();
    startCallTimer();

  } catch (err) {
    // If anything fails, clean up
    stopLocalStream();
    callPeerId = null;
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// DEVICE A — END CALL BUTTON: Hang up the call
// ═══════════════════════════════════════════════════════════════════════════════

document.getElementById("endCallBtn").addEventListener("click", endCall);


// ═══════════════════════════════════════════════════════════════════════════════
// DEVICE B — INCOMING CALL: Receive and display the incoming call popup
// ═══════════════════════════════════════════════════════════════════════════════
//
// FLOW:
//   1. Device B's browser receives "call_offer" event from the server
//   2. The incoming call modal is displayed (shows caller's name + avatar)
//   3. Device B can click "Accept" or "Decline"
//   4. If accepted → Device B captures camera/mic → creates answer → sends back
//   5. If declined → modal closes, no notification sent to Device A (limitation)
// ═══════════════════════════════════════════════════════════════════════════════

socket.on("call_offer", async (data) => {
  // If Device B is already in a call, ignore this incoming call
  if (callActive) return;

  // Store the SDP offer from Device A (we'll use it when accepting)
  incomingOffer = data;

  // Remember who is calling us
  callPeerId = data.from_user_id;

  // Display the caller's name in the incoming call popup
  document.getElementById("incomingCallName").textContent = data.username;

  // Display the caller's avatar (profile pic or initials with colored background)
  const av = document.getElementById("incomingCallAvatarInner");
  const u = (window.__allUsers || []).find(x => x.id === data.from_user_id);
  if (u && u.profile_pic) {
    av.style.backgroundImage = `url(${SUPABASE_URL}/storage/v1/object/public/profiles/${u.profile_pic})`;
    av.style.backgroundSize = "cover";
    av.textContent = "";
  } else {
    av.style.background = avatarColor(data.username);
    av.textContent = getInitials(data.username);
  }

  // Show the incoming call popup with Accept/Decline buttons
  document.getElementById("incomingCall").classList.remove("hidden");
});


// ═══════════════════════════════════════════════════════════════════════════════
// DEVICE B — DECLINE CALL: Reject the incoming call
// ═══════════════════════════════════════════════════════════════════════════════
//
// NOTE: When Device B declines, Device A is NOT notified.
//       Device A's call overlay keeps showing with the timer running.
//       This is a known limitation — Device A has to manually end the call.
// ═══════════════════════════════════════════════════════════════════════════════

document.getElementById("declineCallBtn").addEventListener("click", () => {
  // Hide the incoming call popup
  document.getElementById("incomingCall").classList.add("hidden");

  // Clear the stored offer and peer ID
  incomingOffer = null;
  callPeerId = null;
});


// ═══════════════════════════════════════════════════════════════════════════════
// DEVICE B — ACCEPT CALL: Answer the incoming call
// ═══════════════════════════════════════════════════════════════════════════════
//
// FLOW:
//   1. Device B clicks "Accept"
//   2. Device B captures its camera + microphone
//   3. Device B creates an RTCPeerConnection
//   4. Device B sets Device A's SDP Offer as the remote description
//   5. Device B creates an SDP Answer (says "OK, here's what I support too")
//   6. Device B sends the answer back to Device A via the server
//   7. Device B shows the call overlay and starts the timer
//   8. Device B and Device A exchange ICE candidates
//   9. P2P connection established → video + audio flows directly
// ═══════════════════════════════════════════════════════════════════════════════

document.getElementById("acceptCallBtn").addEventListener("click", async () => {
  if (!incomingOffer) return;

  // Hide the incoming call popup
  document.getElementById("incomingCall").classList.add("hidden");

  try {
    // Step 1: Capture our camera + microphone
    await startLocalStream();

    // Step 2: Create the P2P connection and add our tracks
    createPeerConnection();

    // Step 3: Set Device A's SDP Offer as the remote description
    // This tells our browser: "This is what the OTHER device supports"
    await pc.setRemoteDescription(new RTCSessionDescription(incomingOffer.sdp));

    // Step 4: Create an SDP Answer
    // This describes what Device B supports in response
    const answer = await pc.createAnswer();

    // Step 5: Apply bitrate limit and set as local description
    // This triggers ICE gathering on Device B's side
    await pc.setLocalDescription({ type: "answer", sdp: bumpBitrate(answer.sdp) });

    // Step 6: Send the SDP Answer to Device A through the signaling server
    socket.emit("call_answer", { to_user_id: callPeerId, sdp: pc.localDescription });

    // Step 7: Show the call overlay and start the timer
    showCallOverlay();
    startCallTimer();

  } catch (err) {
    // If anything fails, clean up
    stopLocalStream();
    callPeerId = null;
  }

  // Clear the stored offer (no longer needed)
  incomingOffer = null;
});


// ═══════════════════════════════════════════════════════════════════════════════
// DEVICE A — RECEIVE ANSWER: Device B accepted the call
// ═══════════════════════════════════════════════════════════════════════════════
//
// WHAT HAPPENS:
//   Device A receives the SDP Answer from Device B.
//   Device A sets it as the remote description, completing the SDP exchange.
//   Now both devices know each other's capabilities.
//   ICE candidate exchange continues until a working path is found.
//   Once a path is found → P2P connection is live → video + audio flows!
// ═══════════════════════════════════════════════════════════════════════════════

socket.on("call_answer", async (data) => {
  // Verify:
  //   1. We have an active peer connection (pc exists)
  //   2. We're in the "have-local-offer" state (we sent an offer, now expecting an answer)
  //   3. The answer came from the device we're actually calling (not a stale message)
  if (pc && pc.signalingState === "have-local-offer" && data.from_user_id === callPeerId) {
    // Set Device B's answer as the remote description
    // After this, ICE connectivity checks begin automatically
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// ICE CANDIDATE EXCHANGE — Both devices share network routing info
// ═══════════════════════════════════════════════════════════════════════════════
//
// WHAT HAPPENS:
//   1. Device A's browser discovers ICE candidates (potential network paths)
//   2. Device A sends each candidate to Device B via the server
//   3. Device B receives the candidate and adds it to its peer connection
//   4. Device B does the same in reverse
//   5. Both devices try all candidate pairs to find the BEST working path
//   6. Once a working path is found → P2P connection is established
//
// This happens in parallel with the SDP exchange and continues until connected.
// ═══════════════════════════════════════════════════════════════════════════════

socket.on("ice_candidate", async (data) => {
  // Only process ICE candidates from the device we're currently in a call with
  if (pc && data.from_user_id === callPeerId) {
    try {
      // Add this ICE candidate to our peer connection
      // The browser will try to use it to establish a connection
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (_) {
      // Silently ignore errors — some candidates may fail, but others will work
    }
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// DEVICE B — CALL ENDED: Device A hung up
// ═══════════════════════════════════════════════════════════════════════════════
//
// WHAT HAPPENS:
//   Device A clicked "End Call" → sent "end_call" to server → server sent "call_ended" to Device B
//   Device B receives this and runs endCall() to clean up its own side
// ═══════════════════════════════════════════════════════════════════════════════
socket.on("call_ended", () => {
  endCall();
});
