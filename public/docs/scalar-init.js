// External file because the CSP (script-src 'self') blocks inline scripts.
Scalar.createApiReference("#app", {
  url: "/docs/openapi.yaml",
  // The spec's server is the relative "/api/v1"; resolve it against this origin.
  baseServerURL: window.location.origin,
  // Never phone home, never keep the API key in localStorage.
  telemetry: false,
  persistAuth: false,
  // Fonts come from the Google Fonts <link> in index.html, same as the app.
  withDefaultFonts: false,
  defaultHttpClient: { targetKey: "shell", clientKey: "curl" },
  hideClientButton: true,
  // Early testing phase: the platform team exercises the API from this page.
  // Requests go to this same origin only (CSP connect-src 'self') and create
  // real data, as the spec's intro warns.
  hideTestRequestButton: false,
  // Scalar's cloud upsells (Share / Generate SDK / Deploy API / Ask AI / MCP)
  // don't apply to a self-hosted reference.
  showDeveloperTools: "never",
  agent: { disabled: true },
  mcp: { disabled: true },
  darkMode: true,
  hideDarkModeToggle: true,
  customCss: `
    :root, .dark-mode, .light-mode {
      --scalar-font: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --scalar-font-code: "JetBrains Mono", ui-monospace, Menlo, monospace;
      --scalar-color-accent: #f4a6bb;
    }
    .dark-mode {
      --scalar-background-1: #000000;
      --scalar-background-2: #0a0a0a;
      --scalar-background-3: #141414;
      --scalar-border-color: #1a1a1a;
      --scalar-color-1: #f4a6bb;
      --scalar-color-2: rgba(244, 166, 187, 0.75);
      --scalar-color-3: #777777;
      --scalar-link-color: #f4a6bb;
    }
  `,
});
