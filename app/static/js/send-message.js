function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 120) + "px";
}

async function sendMessage() {
  const input = document.getElementById("messageInput");
  const content = input.value.trim();
  if (!content) return;
  if (!activeUserId) return;

  const sendBtn = document.getElementById("sendBtn");
  const origHtml = sendBtn.innerHTML;
  sendBtn.disabled = true;
  sendBtn.innerHTML = '<span class="send-spinner"></span>';

  let uploaded = [];
  if (pendingMedia.length) {
    try {
      uploaded = await uploadPendingMedia();
    } catch (e) {
      console.error("Upload failed:", e);
    }
    if (!uploaded.length) {
      sendBtn.innerHTML = origHtml;
      sendBtn.disabled = false;
      return;
    }
  }

  const payload = { to_user_id: activeUserId };
  if (content) payload.content = content;
  if (replyTo) payload.reply_to = replyTo;
  if (uploaded.length) {
    payload.media = uploaded.map(m => ({
      file_path: m.file_path,
      file_type: m.file_type,
      file_name: m.file_name,
      file_size: m.file_size,
    }));
  }

  socket.emit("private_message", payload);
  input.value = "";
  input.style.height = "auto";
  clearReply();
  pendingMedia.forEach(m => { if (m._preview) URL.revokeObjectURL(m._preview); });
  pendingMedia = [];
  document.getElementById("mediaPreview").classList.add("hidden");
  socket.emit("stop_typing", { to_user_id: activeUserId });
  clearTimeout(typingTimers[activeUserId]);
  sendBtn.innerHTML = origHtml;
  sendBtn.disabled = false;
  input.focus();
}

document.getElementById("messageForm").addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage();
});

document.getElementById("messageInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

document.getElementById("messageInput").addEventListener("input", (e) => {
  autoResize(e.target);
  document.getElementById("sendBtn").disabled = !e.target.value.trim();
  if (!activeUserId) return;
  socket.emit("typing", { to_user_id: activeUserId });
  clearTimeout(typingTimers[activeUserId]);
  typingTimers[activeUserId] = setTimeout(() => {
    socket.emit("stop_typing", { to_user_id: activeUserId });
  }, 2000);
});
