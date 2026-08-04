export const Provider = ({ children }) => (
  <div
    style={{
      minHeight: "100vh",
      padding: "40px",
      background: "var(--color-bg-base)",
      color: "var(--color-brand-primary)",
      fontFamily: "var(--font-sans)",
    }}
  >
    {children}
  </div>
);
