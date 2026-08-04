import { escapeHtml } from "./util.js";

/* <ub-warning-modal heading message confirm-label cancel-label>
   Replaces window.confirm() for destructive/critical actions (stage
   transitions, remove judge, revoke key, disqualify). Same mount = open
   model as <ub-drawer>: dispatches "ub-confirm" or "ub-cancel" (bubbling)
   only after the exit animation finishes. */
class UbWarningModal extends HTMLElement {
  connectedCallback() {
    const heading = this.getAttribute("heading") || "";
    const message = this.getAttribute("message") || "";
    const confirmLabel = this.getAttribute("confirm-label") || "( Confirm )";
    const cancelLabel = this.getAttribute("cancel-label") || "Abort";

    this.innerHTML = `
      <div class="o-overlay-backdrop" data-ub-modal-backdrop></div>
      <article class="t-warning-box" data-ub-modal-panel role="alertdialog" aria-modal="true">
        <span class="a-section-tag">( System Warning )</span>
        <h2 class="t-warning-box__title">${escapeHtml(heading)}</h2>
        <p class="t-warning-box__message">${escapeHtml(message)}</p>
        <div class="t-warning-box__actions">
          <button type="button" class="a-action-trigger a-action-trigger--primary" data-ub-modal-confirm>${escapeHtml(confirmLabel)}</button>
          <button type="button" class="a-action-trigger a-action-trigger--dim" data-ub-modal-cancel>${escapeHtml(cancelLabel)}</button>
        </div>
      </article>`;

    this.querySelector("[data-ub-modal-backdrop]").addEventListener("click", () => this.cancel());
    this.querySelector("[data-ub-modal-confirm]").addEventListener("click", () => this.confirm());
    this.querySelector("[data-ub-modal-cancel]").addEventListener("click", () => this.cancel());

    this.setAttribute("open", "");
    window.UBMotion.openModal(
      this.querySelector("[data-ub-modal-backdrop]"),
      this.querySelector("[data-ub-modal-panel]"),
    );
  }

  confirm() {
    this._closeThen(() => this.dispatchEvent(new CustomEvent("ub-confirm", { bubbles: true })));
  }

  cancel() {
    this._closeThen(() => this.dispatchEvent(new CustomEvent("ub-cancel", { bubbles: true })));
  }

  // Alias so the shared Escape-key handler in unblocked-motion.js can treat
  // any open overlay uniformly — Escape aborts a warning modal, same as
  // clicking the backdrop or the cancel trigger.
  close() {
    this.cancel();
  }

  _closeThen(onDone) {
    const backdrop = this.querySelector("[data-ub-modal-backdrop]");
    const panel = this.querySelector("[data-ub-modal-panel]");
    window.UBMotion.closeModal(backdrop, panel, () => {
      this.removeAttribute("open");
      onDone();
    });
  }
}

customElements.define("ub-warning-modal", UbWarningModal);
