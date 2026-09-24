/* Wire How to play button ↔ overlay (vanilla, shared by all modes) */
(() => {
  const btn = document.getElementById("btn-how-to-play");
  const overlay = document.getElementById("how-to-play-overlay");
  const closeBtn = document.getElementById("how-to-play-close");
  if (!btn || !overlay) return;

  const open = () => {
    overlay.hidden = false;
  };
  const close = () => {
    overlay.hidden = true;
  };

  btn.addEventListener("click", open);
  closeBtn?.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) close();
  });
})();
