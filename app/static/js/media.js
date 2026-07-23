document.getElementById("attachBtn").addEventListener("click", () => {
  document.getElementById("mediaFileInput").click();
});

document.getElementById("mediaFileInput").addEventListener("change", (e) => {
  const files = e.target.files;
  if (!files || !files.length) return;
  for (const file of files) {
    if (file.size > 5 * 1024 * 1024) {
      alert("Image should not exceed 5MB.");
      continue;
    }
    pendingMedia.push({ file, file_name: file.name, file_size: file.size, file_type: "image", _preview: null });
  }
  pendingMedia.forEach(m => {
    if (m.file_type === "image" && !m._preview) {
      m._preview = URL.createObjectURL(m.file);
    }
  });
  updateMediaPreview();
  document.getElementById("messageInput").focus();
  e.target.value = "";
});

// Clear all pending media and hide the preview bar
document.getElementById("mediaPreviewClose").addEventListener("click", () => {
  pendingMedia.forEach(m => { if (m._preview) URL.revokeObjectURL(m._preview); });
  pendingMedia = [];
  document.getElementById("mediaPreview").classList.add("hidden");
});

// Render thumbnail previews of pending images with individual delete buttons
function updateMediaPreview() {
  if (!pendingMedia.length) {
    document.getElementById("mediaPreview").classList.add("hidden");
    return;
  }
  const count = pendingMedia.length;
  const totalSize = pendingMedia.reduce((s, m) => s + (m.file_size || 0), 0);
  let thumbs = "";
  pendingMedia.forEach((m, i) => {
    thumbs += `<div class="media-thumb" data-index="${i}" style="background-image:url(${m._preview})"><button type="button" class="media-thumb-del" data-index="${i}">&times;</button></div>`;
  });
  document.getElementById("mediaPreviewThumbs").innerHTML = thumbs;
  document.getElementById("mediaPreviewCount").textContent =
    count === 1 ? pendingMedia[0].file_name : `${count} files`;
  document.getElementById("mediaPreviewTotalSize").textContent = formatFileSize(totalSize);
  document.getElementById("mediaPreview").classList.remove("hidden");

  document.querySelectorAll(".media-thumb-del").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      const removed = pendingMedia.splice(idx, 1)[0];
      if (removed && removed._preview) URL.revokeObjectURL(removed._preview);
      updateMediaPreview();
      if (pendingMedia.length === 0) {
        document.getElementById("mediaFileInput").value = "";
      }
    });
  });
}

let lightboxMedia = [];
let lightboxIndex = 0;

// Open fullscreen lightbox viewer for media at given index
function openMediaLightbox(media, index) {
  lightboxMedia = media;
  lightboxIndex = index;
  renderLightboxItem();
  document.getElementById("mediaModalOverlay").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

// Close the fullscreen lightbox viewer
function closeMediaLightbox() {
  document.getElementById("mediaModalOverlay").classList.add("hidden");
  document.body.style.overflow = "";
}

// Render the current lightbox item (image, nav buttons, download link)
function renderLightboxItem() {
  const m = lightboxMedia[lightboxIndex];
  const url = m.data || `${SUPABASE_URL}/storage/v1/object/public/chat_media/${m.file_path}`;
  const content = document.getElementById("mediaModalContent");
  const counter = document.getElementById("mediaModalCounter");
  const filename = document.getElementById("mediaModalFilename");
  const download = document.getElementById("mediaModalDownload");

  counter.textContent = `${lightboxIndex + 1} / ${lightboxMedia.length}`;
  filename.textContent = m.file_name;
  download.href = url;

  content.innerHTML = `<img src="${url}" alt="${escapeHtml(m.file_name)}" />`;

  document.getElementById("mediaNavPrev").classList.toggle("hidden", lightboxIndex === 0);
  document.getElementById("mediaNavNext").classList.toggle("hidden", lightboxIndex >= lightboxMedia.length - 1);
}

document.getElementById("mediaModalClose").addEventListener("click", closeMediaLightbox);
document.getElementById("mediaModalOverlay").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeMediaLightbox();
});
document.getElementById("mediaNavPrev").addEventListener("click", () => {
  if (lightboxIndex > 0) { lightboxIndex--; renderLightboxItem(); }
});
document.getElementById("mediaNavNext").addEventListener("click", () => {
  if (lightboxIndex < lightboxMedia.length - 1) { lightboxIndex++; renderLightboxItem(); }
});
document.addEventListener("keydown", (e) => {
  const overlay = document.getElementById("mediaModalOverlay");
  if (overlay.classList.contains("hidden")) return;
  if (e.key === "Escape") closeMediaLightbox();
  if (e.key === "ArrowLeft" && lightboxIndex > 0) { lightboxIndex--; renderLightboxItem(); e.preventDefault(); }
  if (e.key === "ArrowRight" && lightboxIndex < lightboxMedia.length - 1) { lightboxIndex++; renderLightboxItem(); e.preventDefault(); }
});
