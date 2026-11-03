/** Backend (Clinical Jade) layout, recolored to the Medisense palette. Scoped to `.bk` so existing pages are untouched. */
export default {
  content: ["./src/bk/**/*.{js,jsx}"],
  important: ".bk",
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        surface: { DEFAULT: "#ffffff", dim: "#e8e9ec", bright: "#ffffff", variant: "#eceef1" },
        "surface-container": { lowest: "#ffffff", low: "#fafafa", DEFAULT: "#f4f5f6", high: "#f0f1f3", highest: "#e8e9ec" },
        "on-surface": { DEFAULT: "#1c1c20", variant: "#5d6068" },
        outline: { DEFAULT: "#7b828d", variant: "#d3d6db" },
        hairline: "#e6e8eb",
        primary: { DEFAULT: "#239660", dark: "#1e6242", hover: "#216a48", container: "#239660", fixed: "#d6f5e7", "fixed-dim": "#b9eed5", tint: "#f3fcf8" },
        "on-primary": { DEFAULT: "#ffffff", container: "#f0fcf6", fixed: "#05150d" },
        secondary: { DEFAULT: "#267b53", container: "#e0f8ed" },
        "on-secondary": { DEFAULT: "#ffffff", container: "#1c593d" },
        tertiary: { DEFAULT: "#7b828d", container: "#9a9ca3", fixed: "#eceef1" },
        "on-tertiary": { DEFAULT: "#ffffff", container: "#f4f8f6" },
        error: { DEFAULT: "#ba1a1a", container: "#ffdad6" },
        "on-error": { DEFAULT: "#ffffff", container: "#93000a" },
        warning: { DEFAULT: "#b26a00", container: "#ffe9c7" },
        chip: { bg: "#eefbf5", border: "#d9f6e8" },
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "SF Pro Text", "PingFang TC", "Noto Sans TC", "Segoe UI", "system-ui", "sans-serif"],
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
