import { Html } from "./Html.jsx";

export default { title: "Organisms" };

export const HeaderBar = (args) => (
  <ub-header-bar
    role-label={args.roleLabel}
    other-label={args.otherLabel}
    other-href="#"
    {...(args.otherHidden ? { "other-hidden": true } : {})}
  ></ub-header-bar>
);
HeaderBar.args = { roleLabel: "Judge Portal", otherLabel: "Admin Console", otherHidden: false };

export const CriteriaBar = (args) => (
  <div style={{ minHeight: 80 }}>
    <p>Scroll context — the bar below is position: fixed to the bottom of this preview frame, exactly as it pins during Round 1/Round 2 review.</p>
    <ub-criteria-bar criteria={JSON.stringify(args.criteria)}></ub-criteria-bar>
  </div>
);
CriteriaBar.args = { criteria: ["Theme Relevance", "Concept", "Execution", "Creativity"] };

export const StageNavReadOnly = (args) => (
  <Html
    markup={`
    <nav class="o-stage-nav" aria-label="Contest stage">
      ${["Draft", "Submissions Open", "Round 1 Active", "Round 2 Active", "Deliberation", "Results Ready"]
        .map((label) => `<span class="o-stage-nav__item${label === args.active ? " o-stage-nav__item--active" : ""}">${label}</span>`)
        .join("")}
    </nav>`}
  />
);
StageNavReadOnly.args = { active: "Round 1 Active" };

export const StageNavInteractive = (args) => (
  <Html
    markup={`
    <nav class="o-stage-nav" aria-label="Contest stage">
      ${["Draft", "Submissions Open", "Round 1", "Round 2", "Deliberation", "Complete", "Archived"]
        .map(
          (label) =>
            `<button type="button" class="o-stage-nav__item o-stage-nav__item--clickable${label === args.active ? " o-stage-nav__item--active" : ""}" ${label === args.active ? "disabled" : ""}>${label}</button>`,
        )
        .join("")}
    </nav>`}
  />
);
StageNavInteractive.args = { active: "Round 1" };

export const DataTable = () => (
  <Html
    markup={`
    <div class="o-table-scroll">
      <table class="o-data-table">
        <thead><tr><th>Judge</th><th>Round 1</th><th>Round 2</th><th></th></tr></thead>
        <tbody>
          <tr><td><strong>Elena Moretti</strong><br><small>elena@example.com</small></td><td>10 votes</td><td>8 rated</td><td><button class="a-action-trigger a-action-trigger--danger" type="button">Remove</button></td></tr>
          <tr class="is-disqualified"><td><strong>Disqualified Entry</strong><br><small>OWN-004</small></td><td>3 votes</td><td>0 rated</td><td><button class="a-action-trigger a-action-trigger--dim" type="button">Reinstate</button></td></tr>
        </tbody>
      </table>
    </div>`}
  />
);
