const IDLE_WARN = 300;
const IDLE_COUNTDOWN = 25;

let idleTimer = null;
let countdownTimer = null;
let countdownValue = IDLE_COUNTDOWN;
let isIdleWarning = false;

function resetIdleTimer() {
  if (isIdleWarning) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(showIdleWarning, IDLE_WARN * 1000);
}

const CIRCLE = 2 * Math.PI * 34;

function showIdleWarning() {
  isIdleWarning = true;
  countdownValue = IDLE_COUNTDOWN;
  const ring = document.getElementById("idleRing");
  document.getElementById("idleCountdown").textContent = countdownValue;
  ring.style.strokeDashoffset = "0";
  document.getElementById("idleOverlay").classList.remove("hidden");
  countdownTimer = setInterval(() => {
    countdownValue--;
    document.getElementById("idleCountdown").textContent = countdownValue;
    ring.style.strokeDashoffset = String((1 - countdownValue / IDLE_COUNTDOWN) * CIRCLE);
    if (countdownValue <= 0) {
      clearInterval(countdownTimer);
      expireSession();
    }
  }, 1000);
}

function cancelIdle() {
  if (!isIdleWarning) return;
  isIdleWarning = false;
  clearInterval(countdownTimer);
  document.getElementById("idleOverlay").classList.add("hidden");
  resetIdleTimer();
}

async function expireSession() {
  try {
    await fetch("/api/auth/expire-session", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (_) {}
  socket.disconnect();
  localStorage.removeItem("access_token");
  localStorage.removeItem("user");
  window.location.href = "/";
}

["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"].forEach((ev) => {
  document.addEventListener(ev, () => {
    if (!isIdleWarning) resetIdleTimer();
  }, { passive: true });
});

document.getElementById("idleStayBtn").addEventListener("click", cancelIdle);

resetIdleTimer();
