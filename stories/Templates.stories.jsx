import { useState } from "react";
import { Html } from "./Html.jsx";

export default { title: "Templates" };

export const Drawer = (args) => {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="a-action-trigger" type="button" onClick={() => setOpen(true)}>
        (+) {args.heading}
      </button>
      {open && (
        <ub-drawer
          heading={args.heading}
          ref={(el) => {
            if (el) el.addEventListener("ub-drawer-close", () => setOpen(false), { once: true });
          }}
        >
          <form>
            <label className="m-form-field">Email <input className="a-input-text" type="email" placeholder="judge@example.com" /></label>
            <label className="m-form-field">Name <input className="a-input-text" placeholder="Optional" /></label>
            <button className="a-action-trigger a-action-trigger--primary" type="button" onClick={() => setOpen(false)}>
              (+) Confirm & Invite
            </button>
          </form>
        </ub-drawer>
      )}
    </div>
  );
};
Drawer.args = { heading: "Add Judge to Panel" };

export const WarningModal = (args) => {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="a-action-trigger" type="button" onClick={() => setOpen(true)}>
        Open warning modal
      </button>
      {open && (
        <ub-warning-modal
          heading={args.heading}
          message={args.message}
          ref={(el) => {
            if (!el) return;
            el.addEventListener("ub-confirm", () => setOpen(false), { once: true });
            el.addEventListener("ub-cancel", () => setOpen(false), { once: true });
          }}
        ></ub-warning-modal>
      )}
    </div>
  );
};
WarningModal.args = {
  heading: "Open Submission Stream?",
  message: "Transitioning to Submissions Open unlocks external API entries immediately.",
};

export const GatePanel = (args) => (
  <div style={{ display: "grid", placeItems: "center", minHeight: "50vh" }}>
    <Html
      markup={`
      <article class="t-gate-panel" style="width:min(460px,100%)">
        <span class="a-section-tag">${args.kicker}</span>
        <h2>${args.title}</h2>
        <p>${args.text}</p>
      </article>`}
    />
  </div>
);
GatePanel.args = {
  kicker: "Sign in",
  title: "UNBLOCKED Judging",
  text: "Enter your invited email and we'll send you a one-time sign-in link.",
};
