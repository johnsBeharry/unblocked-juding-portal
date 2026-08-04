import { Html } from "./Html.jsx";

export default { title: "Atoms" };

export const ActionTriggers = () => (
  <div style={{ display: "grid", gap: 20, maxWidth: 320 }}>
    <Html markup={`<button class="a-action-trigger">(+) Add Judge to Panel</button>`} />
    <Html markup={`<button class="a-action-trigger a-action-trigger--dim">Cancel</button>`} />
    <Html markup={`<button class="a-action-trigger a-action-trigger--danger">Remove</button>`} />
    <Html markup={`<button class="a-action-trigger a-action-trigger--primary" type="button">( Confirm Stage Transition )</button>`} />
  </div>
);

export const InputText = (args) => (
  <div style={{ display: "grid", gap: 20, maxWidth: 320 }}>
    <Html markup={`<input class="a-input-text" placeholder="${args.placeholder}">`} />
    <Html
      markup={`<select class="a-input-select"><option>Theme Relevance</option><option>Concept</option></select>`}
    />
    <Html markup={`<textarea class="a-input-textarea" rows="4" placeholder="Message"></textarea>`} />
  </div>
);
InputText.args = { placeholder: "Judge Email Address" };

export const SectionTag = () => <Html markup={`<span class="a-section-tag">Active Poster Entries (02)</span>`} />;

export const PosterThumb = (args) => (
  <div style={{ width: args.variant === "stage" ? 420 : args.variant === "queue" ? 60 : 220 }}>
    <ub-poster-thumb
      variant={args.variant}
      src=""
      file-type=""
      title={args.title}
      art-seed={String(args.artSeed)}
    ></ub-poster-thumb>
  </div>
);
PosterThumb.args = { variant: "thumb", title: "Voices for a Greener Tomorrow", artSeed: 3 };
PosterThumb.argTypes = {
  variant: { options: ["thumb", "queue", "stage"], control: { type: "select" } },
  artSeed: { control: { type: "range", min: 0, max: 9, step: 1 } },
};
