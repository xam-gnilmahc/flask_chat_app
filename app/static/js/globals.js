const token = localStorage.getItem("access_token");
const me = JSON.parse(localStorage.getItem("user") || "null");

if (!token || !me) {
  window.location.href = "/";
}

const SUPABASE_URL = "https://xytkwpuufyxhxidaeaqn.supabase.co";

let activeUserId = null;
let activeUsername = null;
let typingTimers = {};
let replyTo = null;
let unreadCounts = {};
let chatCache = {};

let msgIdCounter = 0;
let selectedFile = null;
let pendingMedia = [];

let activeHasMore = false;
let loadingMore = false;
let lastScrollTop = 0;

const socket = io({ auth: { token } });
