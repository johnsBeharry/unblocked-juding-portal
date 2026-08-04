import { escapeHtml } from "./util.js";

/* <ub-drawer heading>...body markup as children...</ub-drawer>
   Slide-out panel. The app's whole-page render() only ever emits this tag
   when it should be open, so connecting = opening; closing plays the exit
   animation THEN dispatches "ub-drawer-close" (bubbling) so the page can
   clear its state and re-render (which naturally omits the tag next time). */
class UbDrawer extends HTMLElement {
  connectedCallback() {
    const bodyMarkup = this.innerHTML;
    const heading = this.getAttribute("heading") || "";

    this.innerHTML = `
      <div class="o-overlay-backdrop" data-ub-drawer-backdrop></div>
      <aside class="t-drawer-panel" data-ub-drawer-panel role="dialog" aria-modal="true">
        <div class="t-drawer-panel__header">
          <div class="t-drawer-panel__title">${escapeHtml(heading)}</div>
          <button type="button" class="a-action-trigger a-action-trigger--dim" data-ub-drawer-close>(Close)</button>
        </div>
        <div class="t-drawer-panel__body">${bodyMarkup}</div>
      </aside>`;

    this.querySelector("[data-ub-drawer-backdrop]").addEventListener("click", () => this.close());
    this.querySelector("[data-ub-drawer-close]").addEventListener("click", () => this.close());

    this.setAttribute("open", "");
    window.UBMotion.openDrawer(
      this.querySelector("[data-ub-drawer-backdrop]"),
      this.querySelector("[data-ub-drawer-panel]"),
    );
  }

  close() {
    const backdrop = this.querySelector("[data-ub-drawer-backdrop]");
    const panel = this.querySelector("[data-ub-drawer-panel]");
    window.UBMotion.closeDrawer(backdrop, panel, () => {
      this.removeAttribute("open");
      this.dispatchEvent(new CustomEvent("ub-drawer-close", { bubbles: true }));
    });
  }
}

customElements.define("ub-drawer", UbDrawer);
