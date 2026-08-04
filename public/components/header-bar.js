import { escapeHtml } from "./util.js";

/* <ub-header-bar role-label other-label other-href other-hidden>
   Shared brand + role-nav header, identical markup on both index.html and
   admin.html — each page just names itself and the other portal.

   other-hidden is observed (not just read once) because portal.js decides
   whether to reveal the admin link asynchronously, after an API call — that
   can land before or after this element has upgraded/rendered, so the
   reveal has to work either way rather than assuming render() already ran. */
class UbHeaderBar extends HTMLElement {
  static get observedAttributes() {
    return ["role-label", "other-label", "other-href", "other-hidden"];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  render() {
    const roleLabel = this.getAttribute("role-label") || "";
    const otherLabel = this.getAttribute("other-label") || "";
    const otherHref = this.getAttribute("other-href") || "#";
    const otherHidden = this.hasAttribute("other-hidden");

    this.innerHTML = `
      <a class="a-brand-logo" href="/">UNBLOCKED</a>
      <div class="m-role-nav">
        <span class="m-role-nav__active">${escapeHtml(roleLabel)}</span>
        <a href="${escapeHtml(otherHref)}" class="m-role-nav__admin-link" data-staff-link ${otherHidden ? "hidden" : ""}>( ${escapeHtml(otherLabel)} )</a>
      </div>`;
  }
}

customElements.define("ub-header-bar", UbHeaderBar);
