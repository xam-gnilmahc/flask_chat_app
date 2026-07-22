document.getElementById("profileCancelBtn").addEventListener("click", () => {
  document.getElementById("profileModalOverlay").classList.add("hidden");
});

document.getElementById("profileModalOverlay").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) {
    document.getElementById("profileModalOverlay").classList.add("hidden");
  }
});

document.getElementById("profileChooseBtn").addEventListener("click", () => {
  document.getElementById("profileFileInput").click();
});

document.getElementById("profileFileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  selectedFile = file;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = document.getElementById("profilePreviewImg");
    const icon = document.getElementById("profilePreviewIcon");
    img.src = ev.target.result;
    img.classList.remove("hidden");
    icon.classList.add("hidden");
  };
  reader.readAsDataURL(file);
  document.getElementById("profileSaveBtn").disabled = false;
  document.getElementById("profileError").classList.add("hidden");
});

document.getElementById("profileSaveBtn").addEventListener("click", async () => {
  if (!selectedFile) return;
  const btn = document.getElementById("profileSaveBtn");
  btn.disabled = true;
  btn.textContent = "Compressing...";
  let blob;
  try {
    blob = await compressImage(selectedFile, 400, 400, 0.8);
  } catch (e) {
    document.getElementById("profileError").textContent = e.message;
    document.getElementById("profileError").classList.remove("hidden");
    btn.textContent = "Save";
    btn.disabled = false;
    return;
  }
  btn.textContent = "Uploading...";
  const form = new FormData();
  form.append("file", blob, "profile.jpg");
  try {
    const res = await fetch("/api/auth/upload-profile-pic", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
    me.profile_pic = data.profile_pic;
    localStorage.setItem("user", JSON.stringify(me));
    updateMyAvatar();
    document.getElementById("profileModalOverlay").classList.add("hidden");
    document.getElementById("profileFileInput").value = "";
    document.getElementById("profilePreviewImg").classList.add("hidden");
    document.getElementById("profilePreviewIcon").classList.remove("hidden");
  } catch (err) {
    document.getElementById("profileError").textContent = err.message;
    document.getElementById("profileError").classList.remove("hidden");
  }
  btn.textContent = "Save";
  btn.disabled = false;
  selectedFile = null;
});
