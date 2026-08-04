import { escapeHtml } from "./util.js";

/* <ub-star-rating criterion value max readonly>
   One judging criterion's row of stars. Owns its own click handling and
   dispatches a bubbling "ub-rate" CustomEvent ({criterion, value}) — the
   page listens for that instead of reading DOM state on submit. */
class UbStarRating extends HTMLElement {
  static get observedAttributes() {
    return ["criterion", "value", "max", "readonly"];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  render() {
    const criterion = this.getAttribute("criterion") || "";
    const value = Number(this.getAttribute("value") || 0);
    const max = Number(this.getAttribute("max") || 10);
    const readonly = this.hasAttribute("readonly");

    const stars = Array.from({ length: max }, (_, i) => {
      const starValue = i + 1;
      const selected = starValue <= value;
      return `<button type="button" class="a-star-toggle${selected ? " is-selected" : ""}"
        data-star-value="${starValue}" ${readonly ? "disabled" : ""}
        aria-label="${escapeHtml(criterion)} ${starValue} out of ${max}">${selected ? "★" : "☆"}</button>`;
    }).join("");

    this.className = "m-star-rating";
    this.innerHTML = `
      <span class="m-star-rating__label">${escapeHtml(criterion)}</span>
      <div class="m-star-rating__buttons">${stars}</div>`;

    if (readonly) return;
    this.querySelectorAll("[data-star-value]").forEach((button) => {
      button.addEventListener("click", () => {
        const newValue = Number(button.dataset.starValue);
        this.setAttribute("value", String(newValue));
        this.dispatchEvent(new CustomEvent("ub-rate", {
          detail: { criterion, value: newValue },
          bubbles: true,
        }));
      });
    });
  }
}

customElements.define("ub-star-rating", UbStarRating);
