// Get first letter of a name for avatar fallback
function getInitials(name) {
  return name.charAt(0).toUpperCase();
}

// Set avatar element text to initial
function setAvatar(el, name) {
  if (el) el.textContent = getInitials(name);
}

// Sanitize string to prevent XSS by encoding HTML entities
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Generate a deterministic gradient color based on username hash
function avatarColor(name) {
  const colors = [
    "linear-gradient(135deg, #4fff98ff, #3d67e0)",
    "linear-gradient(135deg, #33d17a, #28a865)",
    "linear-gradient(135deg, #ff6767, #e05555)",
    "linear-gradient(135deg, #ffb347, #e69530)",
    "linear-gradient(135deg, #a855f7, #8b3fd6)",
    "linear-gradient(135deg, #ec4899, #d4327d)",
    "linear-gradient(135deg, #06b6d4, #0891b2)",
    "linear-gradient(135deg, #f97316, #d9610e)",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// Format bytes into human-readable string (B, KB, MB)
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// Compress an image file to JPEG blob with max dimensions and quality
function compressImage(file, maxW, maxH, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let w = img.width, h = img.height;
      if (w > maxW || h > maxH) {
        const ratio = Math.min(maxW / w, maxH / h);
        w *= ratio; h *= ratio;
      }
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error("Compression failed"));
        resolve(blob);
      }, "image/jpeg", quality);
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    const url = URL.createObjectURL(file);
    img.src = url;
  });
}
