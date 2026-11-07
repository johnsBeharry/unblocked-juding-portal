// Bundled as raw strings by the "Text" rules in wrangler.jsonc.
declare module "*.md" {
  const content: string;
  export default content;
}

declare module "*.yaml" {
  const content: string;
  export default content;
}
