if (localStorage.getItem("access_token")) {
  window.location.href = "/chat";
}

let isLogin = true;

function toggleAuth() {
  isLogin = !isLogin;
  document.getElementById("loginForm").classList.toggle("hidden", !isLogin);
  document.getElementById("registerForm").classList.toggle("hidden", isLogin);
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

function showMessage(text, isError = true) {
  const el = document.getElementById("authMessage");
  el.textContent = text;
  el.style.color = isError ? "#ff6767" : "#33d17a";
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) return showMessage(data.error || "Login failed");

    localStorage.setItem("access_token", data.access_token);
    localStorage.setItem("user", JSON.stringify(data.user));
    window.location.href = "/chat";
  } catch (err) {
    showMessage("Network error - is the server running?");
  }
});

document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("regUsername").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPassword").value;

  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password }),
    });
    const data = await res.json();
    if (!res.ok) return showMessage(data.error || "Registration failed");

    showMessage("Account created! You can sign in now.", false);
    toggleAuth();
  } catch (err) {
    showMessage("Network error - is the server running?");
  }
});