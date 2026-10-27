---
name: Clinical Jade Intelligence
colors:
  surface: '#f6faf9'
  surface-dim: '#d6dbd9'
  surface-bright: '#f6faf9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f0f4f3'
  surface-container: '#eaefed'
  surface-container-high: '#e5e9e7'
  surface-container-highest: '#dfe3e2'
  on-surface: '#181d1c'
  on-surface-variant: '#3e4947'
  inverse-surface: '#2c3131'
  inverse-on-surface: '#edf2f0'
  outline: '#6e7977'
  outline-variant: '#bdc9c6'
  surface-tint: '#006a60'
  primary: '#00655b'
  on-primary: '#ffffff'
  primary-container: '#0e8074'
  on-primary-container: '#dffff8'
  inverse-primary: '#79d7c8'
  secondary: '#0b6a5d'
  on-secondary: '#ffffff'
  secondary-container: '#a2f2e1'
  on-secondary-container: '#187163'
  tertiary: '#3e605a'
  on-tertiary: '#ffffff'
  tertiary-container: '#577973'
  on-tertiary-container: '#e1fff8'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#95f3e4'
  primary-fixed-dim: '#79d7c8'
  on-primary-fixed: '#00201c'
  on-primary-fixed-variant: '#005048'
  secondary-fixed: '#a2f2e1'
  secondary-fixed-dim: '#86d5c5'
  on-secondary-fixed: '#00201b'
  on-secondary-fixed-variant: '#005046'
  tertiary-fixed: '#c5eae2'
  tertiary-fixed-dim: '#aacec7'
  on-tertiary-fixed: '#00201c'
  on-tertiary-fixed-variant: '#2b4d47'
  background: '#f6faf9'
  on-background: '#181d1c'
  surface-variant: '#dfe3e2'
typography:
  headline-xl:
    fontFamily: Manrope
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
  headline-xl-mobile:
    fontFamily: Manrope
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
  headline-lg:
    fontFamily: Manrope
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
  headline-lg-mobile:
    fontFamily: Manrope
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 30px
  headline-md:
    fontFamily: Manrope
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
  headline-sm:
    fontFamily: Manrope
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Manrope
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Manrope
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Manrope
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-lg:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 16px
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 14px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-desktop: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system establishes an enterprise-grade clinical artificial intelligence workspace built for hospital staff, physicians, researchers, and clinical operations teams. Grounded in the civic trust and clinical heritage of the institution's emblem, the visual tone conveys institutional reliability, precision, and reassuring calm in high-stakes environments.

The design movement blends **Modern Corporate** with refined **Minimalism** and subtle **Tactile Precision**. The interface eliminates sensory overload and fatigue through pristine clinical white canvas spaces, muted sage structural surfaces, and deep medical teal accents. Every interactive element emphasizes clarity, zero-ambiguity workflow routing, high scan-ability, and accessible drag-and-drop orchestration for enterprise AI agents.

## Colors

The color palette directly references the institutional emblem's jade cross and circular seal, balanced for clinical software workflows:

- **Primary (`#0E8074`)**: Emblem jade teal. Applied to primary CTAs, active node borders, critical status indicators, and selected navigation states.
- **Secondary (`#3A8B7D`)**: Supporting medical sage. Used for secondary toggles, agent status badges, active tab borders, and workflow connector lines.
- **Tertiary (`#4E706A`)**: Deep slate teal. Used for informational utility elements, metadata pills, container header titles, and canvas helper text.
- **Neutral (`#5D6261`)**: Warm slate gray. Regulates body text, secondary icons, and structural divider borders without the harshness of pitch black.

### Application Guidelines
- **Backgrounds**: Surfaces default to crisp clinical white (`#FFFFFF`) and faint warm slate mist (`#F7FAF9` to `#EEF4F2`) for canvas workbenches.
- **Semantic Accents**: Error states employ a muted clinical crimson (`#BA1A1A`), warning states use a desaturated amber (`#B26A00`), and success states use emblem jade green (`#0E8074`).
- **Contrast**: Text hierarchy guarantees WCAG 2.1 AAA compliance across all patient-data or agent-configuration views.

## Typography

Typography balances clinical humanism with computational rigor:

- **Primary Family (`Manrope`)**: Delivers clear geometric forms, open counters, and high legibility under varying clinical display calibrations. Used for all headings, labels, buttons, and patient-agent narrative outputs.
- **Technical & Parameter Family (`JetBrains Mono`)**: Deployed for technical node identifiers, input/output schemas, prompt tokens, model version flags, and API payloads.
- **Hierarchy Standard**: Visual hierarchy relies primarily on weight transitions (Regular 400 to SemiBold 600) rather than aggressive scale jumps, keeping dense data-entry views quiet and fatigue-free.

## Layout & Spacing

The layout employs an enterprise multi-panel workspace anchored to a modular 8px spatial grid:

- **Desktop Workspace (Breakpoint ≥ 1280px)**: 3-column architecture featuring a collapsible 240px navigation sidebar, a fluid infinite-canvas workflow builder (middle), and an inspect/configuration rail (380px fixed width) on the right.
- **Tablet / Workstation Cart (768px – 1279px)**: Inspect panels dock into off-canvas side drawers; toolbar utilities consolidate into icon-accessible quick menus.
- **Mobile Handheld (≤ 767px)**: Linear card-based run inspection mode; node building transitions into vertical accordion sequence cards.
- **Density**: Core components use compact 8px/12px padding (`space-sm`/`space-md`) to ensure clinical parameters, prompt forms, and telemetry remain viewable above the fold.

## Elevation & Depth

This design system avoids dark or heavy drop shadows to preserve a sterile, clinical aesthetic:

- **Tonal Layers & Surface Containers**: Hierarchy is achieved primarily by background tint stepping: Canvas Workbench (`#F5F8F7`), Panel Containers (`#FFFFFF`), Nested Node Shells (`#FCFDFC`), and Inset Technical Drawers (`#F0F4F3`).
- **Low-Contrast Outlines ("Clinical Hairlines")**: All card containers, canvas nodes, and inputs utilize 1px crisp borders in `#DCE4E2` (unselected) and `#0E8074` (selected/active).
- **Subtle Elevation**: Floating toolbars, drag-and-drop dragging nodes, and flyout menus employ a soft tinted shadow: `0px 4px 16px rgba(14, 128, 116, 0.08), 0px 1px 3px rgba(0, 0, 0, 0.04)`.

## Shapes

The design system adopts a **Soft (1)** shape language to project precision, efficiency, and enterprise reliability:

- Standard buttons, input controls, chips, and workflow node containers utilize `rounded` (0.25rem / 4px).
- Modal sheets, detached panels, and workflow node grouping clusters employ `rounded-lg` (0.5rem / 8px).
- System-level floating badges and status pills use full rounded caps (pill-shaped) to distinguish transient statuses from structural architecture.

## Components

### Buttons
- **Primary**: Solid `#0E8074` background, crisp white text, 4px border radius. Hover transitions to `#0A6158`. Focus state presents a 2px offset jade focus ring (`#0E8074`).
- **Secondary**: Crisp white background with a 1px border in `#0E8074`, text in `#0E8074`. Hover applies a light jade tint (`#EEF7F5`).
- **Ghost/Tertiary**: No border, slate text (`#4E706A`), applied to canvas zooming and toolbar action triggers.

### Chips & Badges
- **Clinical Model Badges**: Pill-shaped with subtle background (`#E6F2F0`), text in `#0E8074`, and a 1px `#C3E1DC` border.
- **Status Pills**: Mini status dots (4px solid emerald, amber, or jade) enclosed within mono-labeled soft tags (`JetBrains Mono`, 11px) indicating agent deployment readiness (`STAGING`, `PROD`, `SYNCING`).

### Input Fields & Prompt Editors
- Background `#FFFFFF` surrounded by a 1px `#DCE4E2` stroke.
- Focus state elevates with `#0E8074` border and zero vertical shifting. Error state uses muted crimson (`#BA1A1A`).
- Monospaced schema and system prompt text areas include line numbering, parameter highlighting in jade, and variable tokens enclosed in rounded tags.

### Workflow Canvas Nodes (Drag-and-Drop)
- Header band tinted with faint jade (`#F0F7F5`) containing node title, icon, and status dot.
- Body surface is pristine white (`#FFFFFF`) framed by a 1px `#DCE4E2` border.
- Connector ports (input/output circles) aligned along the left and right borders with 8px jade interaction hitboxes. Active drag states glow with a 2px jade contour (`#0E8074`) and elevated soft shadow.

### Lists & Data Grids
- Alternating subtle rows (`#FFFFFF` to `#F9FBFA`) with 1px divider lines (`#E8EFEF`).
- Row hover triggers faint jade wash (`#F2F7F6`). Key columns feature monospaced IDs and bold title text for quick visual sorting.