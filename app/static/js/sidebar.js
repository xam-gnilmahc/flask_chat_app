const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("sidebarOverlay");

function openSidebar() {
  sidebar.classList.add("open");
  overlay.classList.add("open");
}

function closeSidebar() {
  sidebar.classList.remove("open");
  overlay.classList.remove("open");
}

document.getElementById("mobileMenuBtn").addEventListener("click", openSidebar);
overlay.addEventListener("click", closeSidebar);
document.getElementById("mobileBack").addEventListener("click", () => {
  closeSidebar();
  selectUser(null, null);
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  socket.disconnect();
  localStorage.removeItem("access_token");
  localStorage.removeItem("user");
  localStorage.removeItem("e2ee_private_key");
  window.location.href = "/";
});

document.getElementById("searchInput").addEventListener("input", (e) => {
  renderUserList(
    window.__allUsers ? window.__allUsers.filter(u => u.is_online).map(u => u.id) : [],
    e.target.value.trim().toLowerCase()
  );
});

async function loadUsers() {
  const res = await fetch("/api/chat/users", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 422) {
    localStorage.clear();
    window.location.href = "/";
    return;
  }
  const data = await res.json();
  document.getElementById("onlineCount").textContent = data.online_count;
  window.__allUsers = data.users;
  renderUserList(data.users.filter(u => u.is_online).map(u => u.id));
}

async function fetchUnreadCounts() {
  try {
    const res = await fetch("/api/chat/unread-counts", {
      headers: { Authorization: `Bearer ${token}` },
    });
    unreadCounts = await res.json();
    renderUserList(window.__allUsers ? window.__allUsers.filter(u => u.is_online).map(u => u.id) : []);
  } catch (_) {}
}

function renderUserList(onlineIds, filter = "") {
  const users = window.__allUsers || [];
  const list = document.getElementById("userList");
  list.innerHTML = "";

  const filtered = filter
    ? users.filter(u => u.username.toLowerCase().includes(filter))
    : users;

  filtered.forEach((u) => {
    const isOnline = onlineIds.includes(u.id);
    const isTyping = u._typing;
    const isActive = u.id === activeUserId;

    const li = document.createElement("li");
    if (isActive) li.className = "active";

    const dotColor = isOnline ? "online" : "offline";

    let typingHtml = "";
    if (isTyping) {
      typingHtml = `<span class="typing-indicator"><span></span><span></span><span></span></span>`;
    }

    const avatarStyle = u.profile_pic
      ? `background-image:url(${SUPABASE_URL}/storage/v1/object/public/profiles/${u.profile_pic});background-size:cover;background-position:center`
      : `background:${avatarColor(u.username)}`;
    const avatarContent = u.profile_pic ? "" : escapeHtml(getInitials(u.username));
    li.innerHTML = `
      <div class="avatar" style="${avatarStyle}">${avatarContent}</div>
      <div class="user-info">
        <div class="user-name">${escapeHtml(u.username)}${typingHtml}</div>
        <div class="user-preview">${isOnline ? "Online" : "Offline"}</div>
      </div>
      ${unreadCounts[u.id] ? `<span class="unread-badge">${unreadCounts[u.id]}</span>` : `<span class="dot ${dotColor}"></span>`}
    `;
    li.onclick = () => {
      selectUser(u.id, u.username);
      if (window.innerWidth <= 768) closeSidebar();
    };
    list.appendChild(li);
  });
}

document.getElementById("profileDropdownBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  document.getElementById("profileDropdown").classList.toggle("hidden");
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".sidebar-footer")) {
    document.getElementById("profileDropdown").classList.add("hidden");
  }
});

document.getElementById("changeProfilePicBtn").addEventListener("click", () => {
  document.getElementById("profileDropdown").classList.add("hidden");
  document.getElementById("profileModalOverlay").classList.remove("hidden");
  document.getElementById("profileError").classList.add("hidden");
  document.getElementById("profileSaveBtn").disabled = true;
});

function renderProfilePic(el, pic) {
  const img = el.querySelector("img");
  const initial = el.querySelector("span");
  if (pic) {
    img.classList.remove("hidden");
    img.src = `${SUPABASE_URL}/storage/v1/object/public/profiles/${pic}`;
    initial.style.display = "none";
    el.style.background = "none";
  } else {
    img.classList.add("hidden");
    initial.style.display = "";
    el.style.background = "";
    initial.textContent = getInitials(me.username);
  }
}

function updateMyAvatar() {
  renderProfilePic(document.getElementById("meAvatar"), me.profile_pic);
}
