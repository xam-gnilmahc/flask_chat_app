function showChatHeader(text) {
  document.getElementById("chatHeaderName").textContent = text;
}

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

function replyPreviewText(msg) {
  if (msg.content) return msg.content;
  const m = msg.media || [];
  if (m.length === 1) return "[📷 Image]";
  if (m.length > 1) return "[📷 " + m.length + " images]";
  return "";
}

function setReply(msg) {
  if (!msg || (!msg.content && !(msg.media && msg.media.length))) return;
  replyTo = msg.id;
  const preview = document.getElementById("replyPreview");
  const name = msg.sender_id === me.id ? "You" : (msg.sender_username || activeUsername || "User");
  document.getElementById("replyPreviewLabel").textContent = `Replying to ${name}`;
  document.getElementById("replyPreviewText").textContent = replyPreviewText(msg);
  preview.classList.remove("hidden");
  document.getElementById("messageInput").focus();
}

function clearReply() {
  replyTo = null;
  document.getElementById("replyPreview").classList.add("hidden");
}

document.getElementById("replyCloseBtn").addEventListener("click", clearReply);

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
    if (chatCache[activeUserId]) {
      chatCache[activeUserId].messages = data.messages.concat(chatCache[activeUserId].messages);
      chatCache[activeUserId].hasMore = data.has_more;
    }
  } finally {
    loadingMore = false;
    spinner.classList.add("hidden");
  }
}

document.getElementById("chatMessages").addEventListener("scroll", () => {
  const el = document.getElementById("chatMessages");
  if (el.scrollTop < 150 && el.scrollTop < lastScrollTop) {
    loadMoreMessages();
  }
  lastScrollTop = el.scrollTop;
}, { passive: true });

async function selectUser(userId, username) {
  activeUserId = userId;
  activeUsername = username;
  clearReply();
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

  if (chatCache[userId]) {
    const cached = chatCache[userId];
    cached.messages.forEach((m) => appendMessage(m, m.sender_id === me.id));
    activeHasMore = cached.hasMore;
  } else {
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
    chatCache[userId] = { messages: data.messages, hasMore: data.has_more };
    activeHasMore = data.has_more;
  }

  unreadCounts[userId] = 0;
  renderUserList(window.__allUsers ? window.__allUsers.filter(u => u.is_online).map(u => u.id) : []);
  fetch(`/api/chat/mark-read/${userId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

function appendMessage(msg, isMine, targetEl) {
  const container = targetEl || document.getElementById("chatMessages");
  const div = document.createElement("div");
  div.className = `msg ${isMine ? "mine" : "theirs"}`;
  div.dataset.msgId = msg.id;
  div.id = `msg-${msg.id || msgIdCounter++}`;

  let html = "";

  if (msg.reply_to_message) {
    const rname = escapeHtml(msg.reply_to_message.sender_username || "Unknown");
    const rtext = escapeHtml(replyPreviewText(msg.reply_to_message));
    const replyId = msg.reply_to;
    const rm = msg.reply_to_message.media || [];
    const thumb = rm.length ? `<img src="${SUPABASE_URL}/storage/v1/object/public/chat_media/${rm[0].file_path}" class="reply-thumb">` : "";
    html += `<span class="reply-snippet" data-reply-to="${replyId}">${thumb}<span class="reply-snippet-text"><span class="rname">${rname}</span><span class="rtext">${rtext}</span></span></span>`;
  }

  const allMedia = msg.media || [];
  if (allMedia.length > 0) {
    const show = Math.min(allMedia.length, 4);
    const extra = allMedia.length - 4;
    const gridClass = allMedia.length === 1 ? "single" : allMedia.length === 2 ? "pair" : "multi";
    html += `<div class="msg-media-grid ${gridClass}">`;
    for (let i = 0; i < show; i++) {
      const m = allMedia[i];
      const url = `${SUPABASE_URL}/storage/v1/object/public/chat_media/${m.file_path}`;
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
  if (msg.has_replies) {
    metaExtra += ' <span class="replied-badge" title="Has replies">↩</span>';
  }
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
  html += `<button class="reply-arrow" title="Reply"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg></button>`;

  div.innerHTML = html;

  const snippet = div.querySelector(".reply-snippet");
  if (snippet) {
    snippet.addEventListener("click", (e) => {
      e.stopPropagation();
      const replyToId = snippet.dataset.replyTo;
      const target = document.getElementById(`msg-${replyToId}`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.style.transition = "background 0.5s ease";
        target.style.background = "rgba(0,168,132,0.12)";
        setTimeout(() => { target.style.background = ""; }, 1500);
      }
    });
  }

  div.querySelector(".reply-arrow").addEventListener("click", (e) => {
    e.stopPropagation();
    setReply(msg);
  });

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

function showTypingBanner(userId, username) {
  if (userId !== activeUserId) return;
  const banner = document.getElementById("typingBanner");
  document.getElementById("typingName").textContent = username;
  banner.classList.remove("hidden");
  clearTimeout(typingBannerTimer);
}

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
    else if (replyTo) clearReply();
    else emojiPicker.classList.add("hidden");
  }
});
