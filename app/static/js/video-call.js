let pc = null;
let localStream = null;
let remoteStream = null;
let callActive = false;
let callPeerId = null;
let callTimer = null;
let callSeconds = 0;
let incomingOffer = null;

const ICE_SERVERS = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

function enableCallButton(enabled) {
  document.getElementById("callBtn").disabled = !enabled;
}

function updateCallBtnOnline() {
  const user = (window.__allUsers || []).find(u => u.id === activeUserId);
  enableCallButton(!!(activeUserId && user && user.is_online && !callActive));
}

async function startLocalStream() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: true,
    });
    document.getElementById("localVideo").srcObject = localStream;
  } catch (err) {
    alert("Camera / mic access denied. Make sure you're on HTTPS or localhost.");
    throw err;
  }
}

function stopLocalStream() {
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
}

function createPeerConnection() {
  pc = new RTCPeerConnection(ICE_SERVERS);
  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.ontrack = (e) => {
    remoteStream = e.streams[0];
    document.getElementById("remoteVideo").srcObject = remoteStream;
  };
  pc.onicecandidate = (e) => {
    if (e.candidate && callPeerId) {
      socket.emit("ice_candidate", { to_user_id: callPeerId, candidate: e.candidate });
    }
  };
  pc.onconnectionstatechange = () => {
    if (["disconnected","failed","closed"].includes(pc.connectionState)) endCall();
  };
}

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

function showCallOverlay() {
  callActive = true;
  document.getElementById("callOverlay").classList.remove("hidden");
  document.getElementById("callRemoteName").textContent = activeUsername;
  enableCallButton(false);
}

function hideCallOverlay() {
  callActive = false;
  document.getElementById("callOverlay").classList.add("hidden");
  enableCallButton(true);
  updateCallBtnOnline();
  if (callTimer) { clearInterval(callTimer); callTimer = null; }
}

async function endCall() {
  if (pc) { pc.close(); pc = null; }
  stopLocalStream();
  if (callPeerId && callActive) {
    socket.emit("end_call", { to_user_id: callPeerId });
  }
  callPeerId = null;
  hideCallOverlay();
  document.getElementById("localVideo").srcObject = null;
  document.getElementById("remoteVideo").srcObject = null;
}

function bumpBitrate(sdp) {
  return sdp.replace(/a=mid:video\r\n/g, 'a=mid:video\r\nb=AS:2500\r\n');
}

document.getElementById("callBtn").addEventListener("click", async () => {
  if (!activeUserId) return;
  try {
    callPeerId = activeUserId;
    await startLocalStream();
    createPeerConnection();
    const offer = await pc.createOffer();
    await pc.setLocalDescription({ type: "offer", sdp: bumpBitrate(offer.sdp) });
    socket.emit("call_offer", { to_user_id: callPeerId, sdp: pc.localDescription });
    showCallOverlay();
    startCallTimer();
  } catch (err) {
    stopLocalStream();
    callPeerId = null;
  }
});

document.getElementById("endCallBtn").addEventListener("click", endCall);

socket.on("call_offer", async (data) => {
  if (callActive) return;
  incomingOffer = data;
  callPeerId = data.from_user_id;
  document.getElementById("incomingCallName").textContent = data.username;
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
  document.getElementById("incomingCall").classList.remove("hidden");
});

document.getElementById("declineCallBtn").addEventListener("click", () => {
  document.getElementById("incomingCall").classList.add("hidden");
  incomingOffer = null;
  callPeerId = null;
});

document.getElementById("acceptCallBtn").addEventListener("click", async () => {
  if (!incomingOffer) return;
  document.getElementById("incomingCall").classList.add("hidden");
  try {
    await startLocalStream();
    createPeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription(incomingOffer.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription({ type: "answer", sdp: bumpBitrate(answer.sdp) });
    socket.emit("call_answer", { to_user_id: callPeerId, sdp: pc.localDescription });
    showCallOverlay();
    startCallTimer();
  } catch (err) {
    stopLocalStream();
    callPeerId = null;
  }
  incomingOffer = null;
});

socket.on("call_answer", async (data) => {
  if (pc && pc.signalingState === "have-local-offer" && data.from_user_id === callPeerId) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
  }
});

socket.on("ice_candidate", async (data) => {
  if (pc && data.from_user_id === callPeerId) {
    try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (_) {}
  }
});

socket.on("call_ended", () => {
  endCall();
});
