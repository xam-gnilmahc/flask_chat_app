// Auto-grow textarea height up to 120px as user types
function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 120) + "px";
}

// Read a file as base64 data URL
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Compress + base64 encode pending media, then emit private_message via socket
async function sendMessage() {
  const input = document.getElementById("messageInput");
  const content = input.value.trim();
  if (!content && !pendingMedia.length) return;
  if (!activeUserId) return;

  const sendBtn = document.getElementById("sendBtn");
  sendBtn.disabled = true;

  const payload = { to_user_id: activeUserId };
  if (content) payload.content = content;

  if (pendingMedia.length) {
    const tooBig = pendingMedia.some(m => m.file_size > 5 * 1024 * 1024);
    if (tooBig) {
      sendBtn.disabled = false;
      alert("Image should not exceed 5MB.");
      return;
    }
    const mediaItems = await Promise.all(pendingMedia.map(async (m) => {
      const blob = m.file.size > 500 * 1024
        ? await compressImage(m.file, 1200, 1200, 0.8).catch(() => m.file)
        : m.file;
      const data = await fileToBase64(blob);
      return {
        file_name: m.file_name,
        file_size: m.file_size,
        file_type: "image",
        data,     
      };
    }));
    payload.media = mediaItems;
  }

  console.log('send message', payload);
  socket.emit("private_message", payload);

  input.value = "";
  input.style.height = "auto";
  pendingMedia.forEach(m => { if (m._preview) URL.revokeObjectURL(m._preview); });
  pendingMedia = [];
  document.getElementById("mediaPreview").classList.add("hidden");
  socket.emit("stop_typing", { to_user_id: activeUserId });
  clearTimeout(typingTimers[activeUserId]);
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
  document.getElementById("sendBtn").disabled = !e.target.value.trim() && !pendingMedia.length;
  if (!activeUserId) return;
  socket.emit("typing", { to_user_id: activeUserId });
  clearTimeout(typingTimers[activeUserId]);
  typingTimers[activeUserId] = setTimeout(() => {
    socket.emit("stop_typing", { to_user_id: activeUserId });
  }, 2000);
});
