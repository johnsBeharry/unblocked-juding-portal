import { Html } from "./Html.jsx";

export default { title: "Molecules" };

export const StatusTile = (args) => (
  <div style={{ maxWidth: 220 }}>
    <ub-status-tile
      label={args.label}
      value={args.value}
      desc={args.desc}
      {...(args.muted ? { muted: true } : {})}
      {...(args.highlight ? { highlight: true } : {})}
    ></ub-status-tile>
  </div>
);
StatusTile.args = {
  label: "Round 1 progress",
  value: "6/10",
  desc: "Your Yes/No decisions, saved to the judging server.",
  muted: false,
  highlight: false,
};

export const StarRating = (args) => (
  <div style={{ maxWidth: 420 }}>
    <ub-star-rating
      criterion={args.criterion}
      value={String(args.value)}
      max={String(args.max)}
      {...(args.readonly ? { readonly: true } : {})}
    ></ub-star-rating>
  </div>
);
StarRating.args = { criterion: "Concept", value: 6, max: 10, readonly: false };
StarRating.argTypes = {
  value: { control: { type: "range", min: 0, max: 10, step: 1 } },
};

export const NavLink = (args) => (
  <div style={{ maxWidth: 240 }}>
    <ub-nav-link
      view="round-one"
      label={args.label}
      {...(args.active ? { active: true } : {})}
      {...(args.locked ? { locked: true } : {})}
    ></ub-nav-link>
  </div>
);
NavLink.args = { label: "Round 1 Review", active: false, locked: false };

export const ProfileCard = () => (
  <div style={{ maxWidth: 260 }}>
    <Html
      markup={`
      <div class="m-profile-card">
        <span class="m-profile-card__mark">JB</span>
        <div>
          <strong class="m-profile-card__name">Johns Beharry</strong>
          <span class="m-profile-card__role">Judge, Ownership 2026</span>
          <button class="a-action-trigger a-action-trigger--dim" type="button">Sign out</button>
        </div>
      </div>`}
    />
  </div>
);

export const RoleNav = () => (
  <Html
    markup={`
    <div class="m-role-nav">
      <span class="m-role-nav__active">Judge Portal</span>
      <a href="#" class="m-role-nav__admin-link">( Admin Console )</a>
    </div>`}
  />
);
