/**
 * SOCKET EVENT HANDLERS — Frontend listeners for real-time events
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This file registers ALL the socket.io event listeners on the CLIENT side.
 * Each handler responds to an event emitted by the SERVER (Flask-SocketIO).
 *
 * HOW IT FITS IN THE ARCHITECTURE:
 * ─────────────────────────────────
 *   Frontend (This File)              Server (socket_events.py)
 *        │                                  │
 *        │◀── "online_users_update" ────────│  (someone came online/offline)
 *        │◀── "new_message" ────────────────│  (someone sent you a message)
 *        │◀── "message_sent" ───────────────│  (your message was delivered)
 *        │◀── "typing" ─────────────────────│  (someone is typing)
 *        │◀── "stop_typing" ────────────────│  (someone stopped typing)
 *        │◀── "messages_read" ──────────────│  (someone read your messages)
 *        │◀── "error" ──────────────────────│  (something went wrong)
 *        │◀── "bg_image_changed" ───────────│  (someone changed chat background)
 *        │◀── "call_offer" ─────────────────│  (someone is calling you)  → video-call.js
 *        │◀── "call_answer" ────────────────│  (someone accepted your call) → video-call.js
 *        │◀── "ice_candidate" ──────────────│  (network route discovered) → video-call.js
 *        │◀── "call_ended" ─────────────────│  (someone hung up) → video-call.js
 *
 * VARIABLES USED (defined in other files):
 *   - socket:          The Socket.IO connection instance (globals.js)
 *   - me:              Current logged-in user object {id, username, ...} (globals.js)
 *   - activeUserId:    ID of the user whose chat is currently open (globals.js)
 *   - token:           JWT authentication token (globals.js)
 *   - unreadCounts:    {user_id → count} of unread messages (globals.js)
 *   - window.__allUsers: Array of all user objects with is_online flag (globals.js)
 */


// ═══════════════════════════════════════════════════════════════════════════════
// EVENT: connect_error — Socket connection to server failed
// ═══════════════════════════════════════════════════════════════════════════════
//
// WHAT HAPPENS:
//   The browser couldn't establish a Socket.IO connection to the Flask server.
//   This could be because:
//     - Server is down
//     - Network is offline
//     - Firewall blocking the connection
//     - Wrong server URL
//
// WHAT THE USER SEES:
//   The chat header area shows "Connection failed" message
//
// ═══════════════════════════════════════════════════════════════════════════════
socket.on("connect_error", () => {
  showChatHeader("Connection failed");
});


// ═══════════════════════════════════════════════════════════════════════════════
// EVENT: online_users_update — Someone came online or went offline
// ═══════════════════════════════════════════════════════════════════════════════
//
// WHAT HAPPENS:
//   The server broadcasts this event whenever ANY user connects or disconnects.
//   The payload contains the FULL list of currently online users.
//
// WHEN IT'S SENT:
//   - User A connects → server sends to ALL users (including A)
//   - User A disconnects → server sends to ALL remaining users
//
// WHAT THIS HANDLER DOES:
//   1. Extracts online user IDs (excluding current user)
//   2. Updates the online count display
//   3. Updates each user's is_online flag in window.__allUsers
//   4. Re-renders the user list with online/offline status
//   5. Updates the chat header status (online/offline/typing)
//   6. Enables/disables the call button (can only call online users)
//
// ═══════════════════════════════════════════════════════════════════════════════
socket.on("online_users_update", (payload) => {
  // Step 1: Get list of online user IDs, excluding ourselves
  const otherOnlineIds = payload.online_users
    .filter(u => u.id !== me.id)  // Don't count ourselves
    .map(u => u.id);

  // Step 2: Update the online count display (e.g., "3 online")
  document.getElementById("onlineCount").textContent = otherOnlineIds.length;

  // Step 3: Update is_online flag for each user in the global user list
  // This flag is used by renderUserList() to show green/gray dots
  if (window.__allUsers) {
    window.__allUsers.forEach(u => {
      u.is_online = otherOnlineIds.includes(u.id);
    });
  }

  // Step 4: Re-render the user sidebar with updated online/offline status
  renderUserList(otherOnlineIds);

  // Step 5: Update the chat header (shows "Online" / "Offline" / "typing...")
  updateChatHeaderStatus();

  // Step 6: Enable/disable the call button based on whether active user is online
  // setTimeout(0) ensures this runs AFTER the DOM updates
  setTimeout(updateCallBtnOnline, 0);
});


// ═══════════════════════════════════════════════════════════════════════════════
// EVENT: new_message — You received a message from another user
// ═══════════════════════════════════════════════════════════════════════════════
//
// WHAT HAPPENS:
//   Device B (Receiver) gets this event when Device A sends a message.
//   The server relays it to ALL of Device B's connected tabs/devices.
//
// TWO SCENARIOS:
// ──────────────
//   Scenario 1: Chat with that user is OPEN (activeUserId === sender)
//     → Show the message immediately in the chat area
//     → Mark the message as read (since user is looking at it)
//
//   Scenario 2: Chat with that user is CLOSED (viewing a different chat)
//     → Increment the unread count for that user
//     → Re-render user list to show the unread badge (red number)
//
// ═══════════════════════════════════════════════════════════════════════════════
socket.on("new_message", (msg) => {
  if (msg.sender_id === activeUserId) {
    // ─── SCENARIO 1: Chat is open with this sender ──────────────────────
    // Show the message in the chat area (appendMessage with isOwn=false)
    appendMessage(msg, false);

    // Mark the message as read on the server
    // (The sender will see blue double-checkmarks instead of gray)
    fetch(`/api/chat/mark-read/${msg.sender_id}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } else {
    // ─── SCENARIO 2: Chat is NOT open with this sender ──────────────────
    // Increment unread count for this sender
    unreadCounts[msg.sender_id] = (unreadCounts[msg.sender_id] || 0) + 1;

    // Re-render user list to show the red unread badge next to the sender's name
    renderUserList(
      window.__allUsers ? window.__allUsers.filter(u => u.is_online).map(u => u.id) : []
    );
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// EVENT: message_sent — Your own message was delivered to the server
// ═══════════════════════════════════════════════════════════════════════════════
//
// WHAT HAPPENS:
//   Device A (Sender) gets this event after sending a message.
//   The server echoes back the message with a timestamp, confirming delivery.
//
// WHY NEEDED:
//   When you send a message, it appears instantly in your chat (optimistic UI).
//   But the server assigns the actual timestamp. This event updates the message
//   with the server's timestamp and sets the read/delivered status.
//
// WHAT THIS HANDLER DOES:
//   1. Checks if the chat with the receiver is currently open
//   2. Sets is_read = false (message just sent, not read yet)
//   3. Sets delivered = true if receiver is online (they'll see it soon)
//   4. Renders the message on the sender's side with correct status
//
// ═══════════════════════════════════════════════════════════════════════════════
socket.on("message_sent", (msg) => {
  if (msg.receiver_id === activeUserId) {
    // Mark as not read yet (just sent)
    msg.is_read = false;

    // Check if the receiver is online (for delivered status)
    const receiver = (window.__allUsers || []).find(u => u.id === msg.receiver_id);
    msg.delivered = receiver ? receiver.is_online : false;

    // Render the message on the sender's side (isOwn=true → right-aligned, blue)
    appendMessage(msg, true);
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// EVENT: typing — Someone is typing a message to you
// ═══════════════════════════════════════════════════════════════════════════════
//
// WHAT HAPPENS:
//   Device A starts typing → emits "typing" → Server relays to Device B
//   Device B receives this event and shows a "John is typing..." indicator.
//
// WHAT THIS HANDLER DOES:
//   1. Sets _typing = true on the sender's user object
//   2. Re-renders the user list (typing indicator may show in sidebar)
//   3. Shows a typing banner in the chat header area
//
// ═══════════════════════════════════════════════════════════════════════════════
socket.on("typing", (data) => {
  // Mark the sender as typing in our user list
  if (window.__allUsers) {
    window.__allUsers.forEach(u => {
      if (u.id === data.from_user_id) u._typing = true;
    });
  }

  // Re-render user list to reflect typing status
  renderUserList(
    window.__allUsers ? window.__allUsers.filter(u => u.is_online).map(u => u.id) : []
  );

  // Show "John is typing..." banner in the chat header
  showTypingBanner(data.from_user_id, data.username);
});


// ═══════════════════════════════════════════════════════════════════════════════
// EVENT: stop_typing — Someone stopped typing
// ═══════════════════════════════════════════════════════════════════════════════
//
// WHAT HAPPENS:
//   Device A stops typing (pauses for a few seconds or sends the message)
//   → emits "stop_typing" → Server relays to Device B
//   Device B hides the "John is typing..." indicator.
//
// ═══════════════════════════════════════════════════════════════════════════════
socket.on("stop_typing", (data) => {
  // Mark the sender as NOT typing
  if (window.__allUsers) {
    window.__allUsers.forEach(u => {
      if (u.id === data.from_user_id) u._typing = false;
    });
  }

  // Re-render user list to remove typing indicator
  renderUserList(
    window.__allUsers ? window.__allUsers.filter(u => u.is_online).map(u => u.id) : []
  );

  // Hide the typing banner from the chat header
  hideTypingBanner(data.from_user_id);
});


// ═══════════════════════════════════════════════════════════════════════════════
// EVENT: messages_read — Your messages were read by the recipient
// ═══════════════════════════════════════════════════════════════════════════════
//
// WHAT HAPPENS:
//   Device B opens the chat with Device A → server marks all Device A's messages as read
//   → Server emits "messages_read" to Device A
//   Device A's UI updates the message status indicators.
//
// WHAT THIS HANDLER DOES:
//   Finds all messages sent by YOU (class "mine") that haven't been marked as read yet,
//   and updates their status icon from single-check/gray-double-check to blue double-check.
//
// MESSAGE STATUS ICONS:
//   - Single gray check    = Message sent but not delivered (receiver offline)
//   - Double gray check    = Message delivered but not read
//   - Double blue check    = Message read by recipient ✓✓
//
// ═══════════════════════════════════════════════════════════════════════════════
socket.on("messages_read", (data) => {
  // Find all messages in the chat that are mine and not yet marked as read
  document.querySelectorAll(".msg.mine").forEach((el) => {
    const status = el.querySelector(".read-status");
    if (status && !status.classList.contains("read")) {
      // Replace the status icon with blue double-checkmarks (read)
      status.innerHTML = '<svg width="16" height="11" viewBox="0 0 16 11" fill="none"><path d="M1 5.5L4.5 9L11 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 5.5L9.5 9L16 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      status.className = "read-status read";  // Add "read" class for blue color
    }
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// EVENT: error — Server sent an error message
// ═══════════════════════════════════════════════════════════════════════════════
//
// WHAT HAPPENS:
//   The server detected an error (e.g., "Not authenticated", "to_user_id is required")
//   and sent it to the client. This handler displays it in the chat area.
//
// EXAMPLES OF ERRORS:
//   - "Not authenticated" — user's JWT expired or is invalid
//   - "to_user_id is required" — message sent without a recipient
//
// WHAT THE USER SEES:
//   A red error message appears in the center of the chat area, then disappears
//   after 4 seconds.
//
// ═══════════════════════════════════════════════════════════════════════════════
socket.on("error", (err) => {
  console.error("Socket error:", err.message);
  if (err.message) {
    // Create a temporary error message element
    const container = document.getElementById("chatMessages");
    const div = document.createElement("div");
    div.style.cssText = "text-align:center;padding:10px;color:#ff6767;font-size:13px";
    div.textContent = err.message;

    // Add it to the chat area
    container.appendChild(div);

    // Remove it after 4 seconds
    setTimeout(() => div.remove(), 4000);
  }
});
