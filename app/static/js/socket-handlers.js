// Show connection failure in header if socket can't reach server
socket.on("connect_error", () => {
  showChatHeader("Connection failed");
});

// Update user list when someone comes online/goes offline
socket.on("online_users_update", (payload) => {
  const otherOnlineIds = payload.online_users
    .filter(u => u.id !== me.id)
    .map(u => u.id);
  document.getElementById("onlineCount").textContent = otherOnlineIds.length;

  if (window.__allUsers) {
    window.__allUsers.forEach(u => {
      u.is_online = otherOnlineIds.includes(u.id);
    });
  }
  renderUserList(otherOnlineIds);
  updateChatHeaderStatus();
  setTimeout(updateCallBtnOnline, 0);
});

// Incoming message from another user — render or increment unread badge
socket.on("new_message", (msg) => {
  if (msg.sender_id === activeUserId) {
    appendMessage(msg, false);
    fetch(`/api/chat/mark-read/${msg.sender_id}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } else {
    unreadCounts[msg.sender_id] = (unreadCounts[msg.sender_id] || 0) + 1;
    renderUserList(window.__allUsers ? window.__allUsers.filter(u => u.is_online).map(u => u.id) : []);
  }
});

// Confirmation that our own message was sent — render it on our side
socket.on("message_sent", (msg) => {
  if (msg.receiver_id === activeUserId) {
    msg.is_read = false;
    const receiver = (window.__allUsers || []).find(u => u.id === msg.receiver_id);
    msg.delivered = receiver ? receiver.is_online : false;
    appendMessage(msg, true);
  }
});

// Show typing indicator when remote user is typing
socket.on("typing", (data) => {
  if (window.__allUsers) {
    window.__allUsers.forEach(u => {
      if (u.id === data.from_user_id) u._typing = true;
    });
  }
  renderUserList(
    window.__allUsers ? window.__allUsers.filter(u => u.is_online).map(u => u.id) : []
  );
  showTypingBanner(data.from_user_id, data.username);
});

// Remove typing indicator when remote user stops typing
socket.on("stop_typing", (data) => {
  if (window.__allUsers) {
    window.__allUsers.forEach(u => {
      if (u.id === data.from_user_id) u._typing = false;
    });
  }
  renderUserList(
    window.__allUsers ? window.__allUsers.filter(u => u.is_online).map(u => u.id) : []
  );
  hideTypingBanner(data.from_user_id);
});

// Update our sent messages to blue double-check when recipient reads them
socket.on("messages_read", (data) => {
  document.querySelectorAll(".msg.mine").forEach((el) => {
    const status = el.querySelector(".read-status");
    if (status && !status.classList.contains("read")) {
      status.innerHTML = '<svg width="16" height="11" viewBox="0 0 16 11" fill="none"><path d="M1 5.5L4.5 9L11 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 5.5L9.5 9L16 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      status.className = "read-status read";
    }
  });
});

// Display socket-level errors in chat area for a few seconds
socket.on("error", (err) => {
  console.error("Socket error:", err.message);
  if (err.message) {
    const container = document.getElementById("chatMessages");
    const div = document.createElement("div");
    div.style.cssText = "text-align:center;padding:10px;color:#ff6767;font-size:13px";
    div.textContent = err.message;
    container.appendChild(div);
    setTimeout(() => div.remove(), 4000);
  }
});
