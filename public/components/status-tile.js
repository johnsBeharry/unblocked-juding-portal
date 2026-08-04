import { escapeHtml } from "./util.js";

/* <ub-status-tile label value desc muted highlight>
   Dashboard status grid tile / admin contest card. */
class UbStatusTile extends HTMLElement {
  static get observedAttributes() {
    return ["label", "value", "desc", "muted", "highlight"];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  render() {
    const label = this.getAttribute("label") || "";
    const value = this.getAttribute("value") || "";
    const desc = this.getAttribute("desc") || "";
    const muted = this.hasAttribute("muted");
    const highlight = this.hasAttribute("highlight");

    this.className = `m-status-tile${highlight ? " m-status-tile--highlight" : ""}`;
    this.innerHTML = `
      <span class="m-status-tile__label">${escapeHtml(label)}</span>
      <strong class="m-status-tile__value${muted ? " m-status-tile__value--muted" : ""}">${escapeHtml(value)}</strong>
      <p class="m-status-tile__desc">${escapeHtml(desc)}</p>`;
  }
}

customElements.define("ub-status-tile", UbStatusTile);
