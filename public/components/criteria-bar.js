import { escapeHtml, readJSONAttr } from "./util.js";

/* <ub-criteria-bar criteria='["Theme Relevance","Concept"]'>
   Fixed bottom bar pinned during Round 1/Round 2 review. Positioning is
   handled by styling the ub-criteria-bar tag directly (position: fixed),
   so no wrapper element is needed. */
class UbCriteriaBar extends HTMLElement {
  static get observedAttributes() {
    return ["criteria"];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  render() {
    const criteria = readJSONAttr(this, "criteria", []);
    this.innerHTML = `
      <span class="a-section-tag">Judging Criteria</span>
      <div class="o-criteria-bar__list">${criteria.map((c) => `<span>${escapeHtml(c)}</span>`).join("")}</div>`;
  }
}

customElements.define("ub-criteria-bar", UbCriteriaBar);
