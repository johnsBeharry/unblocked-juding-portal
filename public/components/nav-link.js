import { escapeHtml } from "./util.js";

/* <ub-nav-link view label active locked>
   Sidebar navigation item. Dispatches a bubbling "ub-navigate" CustomEvent
   ({view}) — even when locked, so the page can decide whether to show a
   "not open yet" notice (mirrors the previous data-view-target behavior). */
class UbNavLink extends HTMLElement {
  static get observedAttributes() {
    return ["view", "label", "active", "locked"];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  render() {
    const view = this.getAttribute("view") || "";
    const label = this.getAttribute("label") || "";
    const active = this.hasAttribute("active");
    const locked = this.hasAttribute("locked");

    this.innerHTML = `<button type="button"
      class="m-nav-link${active ? " is-active" : ""}${locked ? " is-locked" : ""}"
      aria-disabled="${locked}">${escapeHtml(label)}</button>`;

    this.querySelector("button").addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("ub-navigate", { detail: { view }, bubbles: true }));
    });
  }
}

customElements.define("ub-nav-link", UbNavLink);
