/** Clinical Jade design tokens (stitch_tcvgh_agent_studio/clinical_jade_intelligence/DESIGN.md). */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: { DEFAULT: "#f6faf9", dim: "#d6dbd9", bright: "#f6faf9", variant: "#dfe3e2" },
        "surface-container": { lowest: "#ffffff", low: "#f0f4f3", DEFAULT: "#eaefed", high: "#e5e9e7", highest: "#dfe3e2" },
        "on-surface": { DEFAULT: "#181d1c", variant: "#3e4947" },
        outline: { DEFAULT: "#6e7977", variant: "#bdc9c6" },
        hairline: "#dce4e2",
        primary: { DEFAULT: "#0e8074", dark: "#00655b", hover: "#0a6158", container: "#0e8074", fixed: "#95f3e4", "fixed-dim": "#79d7c8", tint: "#eef7f5" },
        "on-primary": { DEFAULT: "#ffffff", container: "#dffff8", fixed: "#00201c" },
        secondary: { DEFAULT: "#0b6a5d", container: "#a2f2e1" },
        "on-secondary": { DEFAULT: "#ffffff", container: "#187163" },
        tertiary: { DEFAULT: "#3e605a", container: "#577973", fixed: "#c5eae2" },
        "on-tertiary": { DEFAULT: "#ffffff", container: "#e1fff8" },
        error: { DEFAULT: "#ba1a1a", container: "#ffdad6" },
        "on-error": { DEFAULT: "#ffffff", container: "#93000a" },
        warning: { DEFAULT: "#b26a00", container: "#ffe9c7" },
        chip: { bg: "#e6f2f0", border: "#c3e1dc" },
      },
      fontFamily: {
        sans: ["Manrope", "Noto Sans TC", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: { sm: "0.125rem", DEFAULT: "0.25rem", md: "0.375rem", lg: "0.5rem", xl: "0.75rem" },
      boxShadow: {
        float: "0px 4px 16px rgba(14, 128, 116, 0.08), 0px 1px 3px rgba(0, 0, 0, 0.04)",
        card: "0px 1px 2px rgba(0, 0, 0, 0.04)",
      },
      spacing: { xs: "0.25rem", sm: "0.5rem", md: "1rem", lg: "1.5rem", xl: "2.5rem" },
    },
  },
  plugins: [],
};
