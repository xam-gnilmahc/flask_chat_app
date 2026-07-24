// Set a temporary text in the chat header (e.g. connection failed)
function showChatHeader(text) {
  document.getElementById("chatHeaderName").textContent = text;
}

// Show Online/Offline status of the currently active chat user
function updateChatHeaderStatus() {
  const statusEl = document.getElementById("chatHeaderStatus");
  if (!activeUserId || !window.__allUsers) {
    statusEl.innerHTML = '<span class="dot offline"></span> Offline';
    return;
  }
  const user = window.__allUsers.find(u => u.id === activeUserId);
  if (user && user.is_online) {
    statusEl.innerHTML = '<span class="dot online"></span> Online';
  } else {
    statusEl.innerHTML = '<span class="dot offline"></span> Offline';
  }
}

async function loadMoreMessages() {
  if (loadingMore || !activeHasMore || !activeUserId) return;
  loadingMore = true;
  const container = document.getElementById("chatMessages");
  const spinner = document.getElementById("loadMoreSpinner");
  spinner.classList.remove("hidden");
  const firstMsg = container.querySelector(".msg");
  if (!firstMsg) { loadingMore = false; spinner.classList.add("hidden"); return; }
  const beforeId = firstMsg.dataset.msgId;
  try {
    const res = await fetch(`/api/chat/history/${activeUserId}?before=${beforeId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!data.messages || data.messages.length === 0) { activeHasMore = false; return; }
    const oldScrollHeight = container.scrollHeight;
    const fragment = document.createDocumentFragment();
    data.messages.forEach((m) => {
      appendMessage(m, m.sender_id === me.id, fragment);
    });
    container.insertBefore(fragment, container.firstChild);
    container.scrollTop = container.scrollHeight - oldScrollHeight;
    activeHasMore = data.has_more;
  } finally {
    loadingMore = false;
    spinner.classList.add("hidden");
  }
}

// Detect scroll to top and trigger loadMoreMessages
document.getElementById("chatMessages").addEventListener("scroll", () => {
  const el = document.getElementById("chatMessages");
  if (el.scrollTop < 150 && el.scrollTop < lastScrollTop) {
    loadMoreMessages();
  }
  lastScrollTop = el.scrollTop;
}, { passive: true });

// Switch active conversation: fetch history and render messages for selected user
async function selectUser(userId, username) {
  if (userId === activeUserId) return;
  activeUserId = userId;
  activeUsername = username;
  activeHasMore = false;
  loadingMore = false;
  lastScrollTop = 0;

  document.getElementById("chatArea").classList.toggle("hidden", !userId);

  [...document.getElementById("userList").children].forEach((li) => li.classList.remove("active"));

  if (!userId) return;

  document.getElementById("messageInput").disabled = false;
  document.getElementById("sendBtn").disabled = true;
  document.getElementById("messageInput").focus();

  document.getElementById("chatHeaderName").textContent = username;
  const chatAvatar = document.getElementById("chatAvatar");
  const otherUser = (window.__allUsers || []).find(u => u.id === userId);
  if (otherUser && otherUser.profile_pic) {
    chatAvatar.style.backgroundImage = `url(${SUPABASE_URL}/storage/v1/object/public/profiles/${otherUser.profile_pic})`;
    chatAvatar.style.backgroundSize = "cover";
    chatAvatar.style.backgroundPosition = "center";
    chatAvatar.style.background = `url(${SUPABASE_URL}/storage/v1/object/public/profiles/${otherUser.profile_pic}) center/cover`;
    chatAvatar.textContent = "";
  } else {
    setAvatar(chatAvatar, username);
    chatAvatar.style.background = avatarColor(username);
  }
  updateChatHeaderStatus();
  updateCallBtnOnline();

  const container = document.getElementById("chatMessages");
  container.querySelectorAll(".msg, .skel-list").forEach(el => el.remove());

  const skel = document.createElement("div");
  skel.className = "skel-list";
  skel.innerHTML = `
    <div class="skel-row skel-theirs">
      <div class="skel-avatar"></div>
      <div class="skel-bubble"><div class="skel-line w70"></div><div class="skel-line w40"></div></div>
    </div>
    <div class="skel-row skel-theirs" style="margin-left:44px">
      <div class="skel-bubble"><div class="skel-line w55"></div></div>
    </div>
    <div class="skel-row skel-mine">
      <div class="skel-bubble"><div class="skel-line w65"></div><div class="skel-line w35"></div></div>
    </div>
    <div class="skel-row skel-theirs">
      <div class="skel-avatar"></div>
      <div class="skel-bubble"><div class="skel-line w80"></div><div class="skel-line w45"></div></div>
    </div>
    <div class="skel-row skel-mine">
      <div class="skel-bubble"><div class="skel-line w50"></div></div>
    </div>
    <div class="skel-row skel-mine">
      <div class="skel-bubble"><div class="skel-line w75"></div><div class="skel-line w30"></div></div>
    </div>`;
  container.insertBefore(skel, container.firstChild);

  const res = await fetch(`/api/chat/history/${userId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  container.querySelectorAll(".skel-list").forEach(el => el.remove());

  data.messages.forEach((m) => appendMessage(m, m.sender_id === me.id));
  activeHasMore = data.has_more;
  unreadCounts[userId] = 0;
  renderUserList(window.__allUsers ? window.__allUsers.filter(u => u.is_online).map(u => u.id) : []);
  fetch(`/api/chat/mark-read/${userId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Build and insert a message bubble into the chat container
function appendMessage(msg, isMine, targetEl) {
  const container = targetEl || document.getElementById("chatMessages");
  const div = document.createElement("div");
  div.className = `msg ${isMine ? "mine" : "theirs"}`;
  div.dataset.msgId = msg.id;
  div.id = `msg-${msg.id || msgIdCounter++}`;

  let html = "";

  const allMedia = msg.media || [];
  if (allMedia.length > 0) {
    const show = Math.min(allMedia.length, 4);
    const extra = allMedia.length - 4;
    const gridClass = allMedia.length === 1 ? "single" : allMedia.length === 2 ? "pair" : "multi";
    html += `<div class="msg-media-grid ${gridClass}">`;
    for (let i = 0; i < show; i++) {
      const m = allMedia[i];
      const url = m.data || `${SUPABASE_URL}/storage/v1/object/public/chat_media/${m.file_path}`;
      html += `<div class="media-cell" data-media-index="${i}">`;
      html += `<img src="${url}" alt="${escapeHtml(m.file_name)}" loading="lazy" />`;
      if (i === 3 && extra > 0) {
        html += `<div class="media-overlay">+${extra}</div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
  }

  if (msg.content) {
    html += escapeHtml(msg.content);
  }

  let metaExtra = "";
  if (isMine) {
    const baseSvg = (stroke) => `<svg width="16" height="11" viewBox="0 0 16 11" fill="none"><path d="M1 5.5L4.5 9L11 2" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 5.5L9.5 9L16 2" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const singleSvg = (stroke) => `<svg width="16" height="11" viewBox="0 0 16 11" fill="none"><path d="M1 5.5L5.5 10L12 2" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    if (msg.is_read === true) {
      metaExtra += ' <span class="read-status read">' + baseSvg('currentColor') + '</span>';
    } else if (msg.delivered === false) {
      metaExtra += ' <span class="read-status sent">' + singleSvg('currentColor') + '</span>';
    } else {
      metaExtra += ' <span class="read-status delivered">' + baseSvg('currentColor') + '</span>';
    }
  }

  html += `<span class="meta">${new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${metaExtra}</span>`;

  div.innerHTML = html;

  const mediaCells = div.querySelectorAll(".media-cell[data-media-index]");
  if (mediaCells.length > 0) {
    const allMedia = msg.media || [];
    mediaCells.forEach(cell => {
      cell.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(cell.dataset.mediaIndex);
        openMediaLightbox(allMedia, idx);
      });
    });
  }

  container.appendChild(div);
  if (!targetEl) {
    container.scrollTop = container.scrollHeight;
  }
}

let typingBannerTimer = null;

// Show "typing..." banner above the input when remote user is typing
function showTypingBanner(userId, username) {
  if (userId !== activeUserId) return;
  const banner = document.getElementById("typingBanner");
  document.getElementById("typingName").textContent = username;
  banner.classList.remove("hidden");
  clearTimeout(typingBannerTimer);
}

// Hide "typing..." banner when remote user stops typing
function hideTypingBanner(userId) {
  if (userId && userId !== activeUserId) return;
  const banner = document.getElementById("typingBanner");
  banner.classList.add("hidden");
  clearTimeout(typingBannerTimer);
}

const EMOJIS = [
  "😊","😂","😍","🥰","😎","😭","😡","🔥",
  "❤️","💔","👍","👎","🎉","🙏","💯","✨",
  "🤣","😁","😅","😘","🥺","😤","🤔","🙄",
  "👀","💀","🎶","✅","❌","⭐","💪","🫡",
];

const emojiBtn = document.getElementById("emojiBtn");
const emojiPicker = document.getElementById("emojiPicker");

EMOJIS.forEach((e) => {
  const btn = document.createElement("button");
  btn.textContent = e;
  btn.type = "button";
  btn.addEventListener("click", () => {
    const input = document.getElementById("messageInput");
    input.value += e;
    autoResize(input);
    input.focus();
    emojiPicker.classList.add("hidden");
  });
  emojiPicker.appendChild(btn);
});

emojiBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  emojiPicker.classList.toggle("hidden");
});

document.addEventListener("click", () => {
  emojiPicker.classList.add("hidden");
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (sidebar.classList.contains("open")) closeSidebar();
    emojiPicker.classList.add("hidden");
  }
});
