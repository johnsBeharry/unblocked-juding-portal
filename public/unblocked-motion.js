/* Shared GSAP-eased open/close motion for <ub-drawer> and <ub-warning-modal>
   (and any other backdrop+panel overlay). Falls back to an instant show/hide
   if GSAP failed to load, so the app never gets stuck mid-animation. */

(function () {
  const gsap = window.gsap;

  const EASE_OUT = "power2.out";
  const EASE_IN = "power2.in";
  const EASE_INOUT = "power3.inOut";

  function openDrawer(backdrop, panel) {
    if (!gsap) {
      backdrop.style.opacity = "1";
      backdrop.style.pointerEvents = "auto";
      panel.style.transform = "translateX(0%)";
      return;
    }
    gsap.set(panel, { x: "100%" });
    gsap.set(backdrop, { opacity: 0, pointerEvents: "none" });
    gsap.to(backdrop, { opacity: 1, pointerEvents: "auto", duration: 0.4, ease: EASE_OUT });
    gsap.to(panel, { x: "0%", duration: 0.5, ease: EASE_INOUT });
  }

  function closeDrawer(backdrop, panel, onComplete) {
    if (!gsap) {
      backdrop.style.opacity = "0";
      backdrop.style.pointerEvents = "none";
      panel.style.transform = "translateX(100%)";
      onComplete && onComplete();
      return;
    }
    gsap.to(backdrop, { opacity: 0, pointerEvents: "none", duration: 0.3, ease: EASE_IN });
    gsap.to(panel, { x: "100%", duration: 0.4, ease: EASE_INOUT, onComplete });
  }

  function openModal(backdrop, panel) {
    if (!gsap) {
      backdrop.style.opacity = "1";
      backdrop.style.pointerEvents = "auto";
      panel.style.opacity = "1";
      panel.style.transform = "translateY(0)";
      return;
    }
    gsap.set(panel, { y: 20, opacity: 0 });
    gsap.set(backdrop, { opacity: 0, pointerEvents: "none" });
    gsap.to(backdrop, { opacity: 1, pointerEvents: "auto", duration: 0.3, ease: EASE_OUT });
    gsap.to(panel, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out", delay: 0.05 });
  }

  function closeModal(backdrop, panel, onComplete) {
    if (!gsap) {
      backdrop.style.opacity = "0";
      backdrop.style.pointerEvents = "none";
      panel.style.opacity = "0";
      onComplete && onComplete();
      return;
    }
    gsap.to(panel, { y: 12, opacity: 0, duration: 0.25, ease: EASE_IN });
    gsap.to(backdrop, { opacity: 0, pointerEvents: "none", duration: 0.3, ease: EASE_IN, onComplete });
  }

  window.UBMotion = { openDrawer, closeDrawer, openModal, closeModal };

  // Centralized Escape-to-close: whichever overlay is currently open wins.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const open = document.querySelector("ub-drawer[open], ub-warning-modal[open]");
    if (open && typeof open.close === "function") open.close();
  });
})();
