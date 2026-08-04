/** @type {import('@ladle/react').UserConfig} */
export default {
  stories: "stories/**/*.stories.jsx",
  outDir: "build",
  // Loads the exact same static files the production app loads (Ladle serves
  // ./public at the root, same as the Worker), so stories stay byte-identical
  // to what ships: fonts, design tokens, vendored GSAP, and the ub-* custom
  // element registry.
  appendToHead: `
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/styles.css">
    <script src="/vendor/gsap.min.js"></script>
    <script src="/unblocked-motion.js"></script>
    <script type="module" src="/components/index.js"></script>
  `,
  addons: {
    theme: {
      enabled: true,
      defaultState: "dark",
    },
  },
};
