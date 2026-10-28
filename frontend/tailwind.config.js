/** Backend (Clinical Jade) layout, recolored to the Medisense palette. Scoped to `.bk` so existing pages are untouched. */
export default {
  content: ["./src/bk/**/*.{js,jsx}"],
  important: ".bk",
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        surface: { DEFAULT: "#ffffff", dim: "#e4eae7", bright: "#ffffff", variant: "#e9efec" },
        "surface-container": { lowest: "#ffffff", low: "#f7faf9", DEFAULT: "#f1f5f3", high: "#ecf1ef", highest: "#e5ebe8" },
        "on-surface": { DEFAULT: "#1c1c20", variant: "#4a4a54" },
        outline: { DEFAULT: "#74747e", variant: "#c9c9d2" },
        hairline: "#eaf0ed",
        primary: { DEFAULT: "#23945f", dark: "#1e6242", hover: "#216a48", container: "#23945f", fixed: "#d6f5e7", "fixed-dim": "#b9eed5", tint: "#f1fcf7" },
        "on-primary": { DEFAULT: "#ffffff", container: "#f0fcf6", fixed: "#05150d" },
        secondary: { DEFAULT: "#267b53", container: "#e0f8ed" },
        "on-secondary": { DEFAULT: "#ffffff", container: "#1c593d" },
        tertiary: { DEFAULT: "#6b6b78", container: "#8a8a98", fixed: "#e8eeeb" },
        "on-tertiary": { DEFAULT: "#ffffff", container: "#f4f8f6" },
        error: { DEFAULT: "#ba1a1a", container: "#ffdad6" },
        "on-error": { DEFAULT: "#ffffff", container: "#93000a" },
        warning: { DEFAULT: "#b26a00", container: "#ffe9c7" },
        chip: { bg: "#eefbf5", border: "#d9f6e8" },
      },
      fontFamily: {
        sans: ["Inter", "Noto Sans TC", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: { sm: "0.125rem", DEFAULT: "0.25rem", md: "0.375rem", lg: "0.5rem", xl: "0.75rem" },
      boxShadow: {
        float: "0px 4px 16px rgba(35, 148, 95, 0.08), 0px 1px 3px rgba(0, 0, 0, 0.04)",
        card: "0px 1px 2px rgba(0, 0, 0, 0.04)",
      },
      spacing: { xs: "0.25rem", sm: "0.5rem", md: "1rem", lg: "1.5rem", xl: "2.5rem" },
    },
  },
  plugins: [],
};
