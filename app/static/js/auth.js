if (localStorage.getItem("access_token")) {
  window.location.href = "/chat";
}

let isLogin = true;

function toggleAuth() {
  isLogin = !isLogin;
  const loginForm = document.getElementById("loginForm");
  const regForm = document.getElementById("registerForm");
  if (isLogin) {
    loginForm.classList.remove("auth-hidden");
    regForm.classList.add("auth-hidden");
  } else {
    regForm.classList.remove("auth-hidden");
    loginForm.classList.add("auth-hidden");
  }
  const label = isLogin ? "Don't have an account?" : "Already have an account?";
  const link = isLogin ? "Register" : "Sign In";
  const title = isLogin ? "Welcome back" : "Create account";
  const subtitle = isLogin ? "Sign in to continue" : "Join the conversation";
  document.getElementById("toggleText").textContent = label;
  document.getElementById("toggleLink").textContent = link;
  document.getElementById("formTitle").textContent = title;
  document.getElementById("formSubtitle").textContent = subtitle;
  document.getElementById("authMessage").textContent = "";
}

function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  const isPassword = input.type === "password";
  input.type = isPassword ? "text" : "password";
  btn.querySelector(".eye-open").classList.toggle("hidden", isPassword);
  btn.querySelector(".eye-closed").classList.toggle("hidden", !isPassword);
}

function checkPwStrength(pw, barId, labelId) {
  const bar = document.getElementById(barId);
  const label = document.getElementById(labelId);
  if (!pw) { bar.style.width = "0"; label.textContent = ""; return; }
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  const levels = ["", "Weak", "Weak", "Medium", "Strong", "Very Strong"];
  const colors = ["", "#ff6767", "#ff6767", "#f5a623", "#25d366", "#00a884"];
  const widths = ["", "25%", "25%", "55%", "80%", "100%"];
  label.textContent = levels[score];
  bar.style.width = widths[score];
  bar.style.background = colors[score];
}

document.getElementById("regPassword").addEventListener("input", (e) => {
  checkPwStrength(e.target.value, "regPwBarFill", "regPwLabel");
});

function showMessage(text, isError = true) {
  const el = document.getElementById("authMessage");
  el.textContent = text;
  el.style.color = isError ? "#ff6767" : "#33d17a";
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  const btn = document.getElementById("loginSubmitBtn");

  btn.disabled = true;
  btn.querySelector(".btn-text").classList.add("hidden");
  btn.querySelector(".btn-spinner").classList.remove("hidden");

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      btn.disabled = false;
      btn.querySelector(".btn-text").classList.remove("hidden");
      btn.querySelector(".btn-spinner").classList.add("hidden");
      return showMessage(data.error || "Login failed");
    }

    localStorage.setItem("access_token", data.access_token);
    localStorage.setItem("user", JSON.stringify(data.user));
    window.location.href = "/chat";
  } catch (err) {
    btn.disabled = false;
    btn.querySelector(".btn-text").classList.remove("hidden");
    btn.querySelector(".btn-spinner").classList.add("hidden");
    showMessage("Network error - is the server running?");
  }
});

document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("regUsername").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPassword").value;
  const btn = document.getElementById("registerSubmitBtn");

  btn.disabled = true;
  btn.querySelector(".btn-text").classList.add("hidden");
  btn.querySelector(".btn-spinner").classList.remove("hidden");

  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      btn.disabled = false;
      btn.querySelector(".btn-text").classList.remove("hidden");
      btn.querySelector(".btn-spinner").classList.add("hidden");
      return showMessage(data.error || "Registration failed");
    }

    btn.disabled = false;
    btn.querySelector(".btn-text").classList.remove("hidden");
    btn.querySelector(".btn-spinner").classList.add("hidden");
    showMessage("Account created! You can sign in now.", false);
    toggleAuth();
  } catch (err) {
    btn.disabled = false;
    btn.querySelector(".btn-text").classList.remove("hidden");
    btn.querySelector(".btn-spinner").classList.add("hidden");
    showMessage("Network error - is the server running?");
  }
});