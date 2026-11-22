---
name: Sales & Money Book
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#45464d'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#0051d5'
  on-secondary: '#ffffff'
  secondary-container: '#316bf3'
  on-secondary-container: '#fefcff'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#002114'
  on-tertiary-container: '#069669'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#dbe1ff'
  secondary-fixed-dim: '#b4c5ff'
  on-secondary-fixed: '#00174b'
  on-secondary-fixed-variant: '#003ea8'
  tertiary-fixed: '#85f8c4'
  tertiary-fixed-dim: '#68dba9'
  on-tertiary-fixed: '#002114'
  on-tertiary-fixed-variant: '#005137'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 2rem
    fontWeight: '700'
    lineHeight: 2.5rem
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.5rem
    fontWeight: '600'
    lineHeight: 2rem
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.25rem
    fontWeight: '600'
    lineHeight: 1.75rem
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.125rem
    fontWeight: '600'
    lineHeight: 1.5rem
  body-lg:
    fontFamily: Inter
    fontSize: 1rem
    fontWeight: '400'
    lineHeight: 1.5rem
  body-md:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: 1.25rem
  body-sm:
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1rem
  label-lg:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: '600'
    lineHeight: 1.25rem
    letterSpacing: 0.01em
  label-md:
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: '600'
    lineHeight: 1rem
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Inter
    fontSize: 0.6875rem
    fontWeight: '700'
    lineHeight: 0.875rem
    letterSpacing: 0.04em
  numeric-table:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: '500'
    lineHeight: 1.25rem
  numeric-metric:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.75rem
    fontWeight: '700'
    lineHeight: 2.25rem
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-lg: 1.5rem
  margin: 1rem
  margin-md: 1.5rem
  margin-lg: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system drives the operational financial ledger for high-velocity distribution enterprise management. The brand personality embodies precision, fiscal authority, understated warmth, and operational velocity. Designed specifically for daily wholesale reconciliation, collection balancing, and cashflow tracking, the visual tone avoids superficial fintech ornamentation in favor of crisp administrative trust and utilitarian poise.

The design movement combines **Corporate Modern** with **High-Density Utility Ledger Architecture**:
- **Fiscal Clarity**: Visual hierarchy strictly mirrors balance-sheet structures: opening balance, debits, credits, verified receipts, and live operational balances.
- **Warm Restraint**: Replaces sterile cold-white enterprise sheets with soft bone and slate-cream backings, mitigating retinal fatigue during prolonged 10-hour audit and entry workflows.
- **Physical Ledger Tactility**: Subtle structural dividing lines, micro-segmented balance banners, and tactile confirmation states mirror the dependability of classic bound ledger volumes while delivering instant keyboard-first computation.

## Colors

The palette establishes an immutable hierarchy tuned for transactional processing, status auditing, and error prevention under variable commercial display conditions.

- **Primary Canvas & Neutral Surfaces**: Base canvas utilizes warm slate tints (`#f8fafc` fading into `#f1f5f9`), avoiding stark `#ffffff` glare. Card surfaces and sheet rows utilize crisp `#ffffff` resting over the slate ground.
- **Structural Identity (`#0f172a` & `#1e293b`)**: Deep Slate Navy commands high-level navigation, categorical headers, table column titles, and critical totals.
- **Action & Focus Blue (`#2563eb`)**: Reserved strictly for directional navigation, interactive row focuses, active tabs, keyboard cell highlights, and primary CTA triggers.
- **Verified Collections & Inflow Green (`#059669` / `#10b981`)**: Applied exclusively to reconciled collections, positive cash inflows, cleared drafts, and balanced audits.
- **Pending & Suspense Amber (`#d97706` / `#f59e0b`)**: Marks unverified counter foils, provisional credits, outstanding drafts, and unallocated deposits.
- **Liability & Outflow Crimson (`#dc2626`)**: Encodes debit memos, shortfalls, overdue vendor payables, and reconciliation variances.

## Typography

The typography strategy leverages two deliberate type engines to balance structural legibility with exact arithmetic data presentation.

- **Plus Jakarta Sans** is dedicated to operational titles, total balance summaries, navigation anchors, and fiscal cards. It adds friendly yet authoritative presence to commercial balance reporting.
- **Inter** handles high-volume tabular ledger data, operational controls, form inputs, and descriptive text.
- **Tabular Figures & Currency Alignment**: All ledger numbers, quantities, folio codes, and Indian Rupee values (`₹`) must enforce OpenType tabular figures (`font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1`). Rupee amounts are right-aligned across all tables, with the currency symbol standardized to 1-pixel lower visual baseline to preserve mathematical digit vertical paths.

## Layout & Spacing

The system implements a desktop-first, dense fluid workspace model that adapts into a field-ready mobile PWA interface.

- **Grid Architecture**:
  - **Desktop (1024px and above)**: 12-column layout with fixed 240px collapsable left operational sidebar, 1.5rem (`gutter-lg`) horizontal columns, and maximum standard canvas width of 1600px to maintain single-screen balance audits.
  - **Tablet (768px - 1023px)**: 8-column layout with compact collapsible navigation and 1rem (`gutter`) column separation.
  - **Mobile PWA (below 768px)**: Single column with edge-to-edge scrollable data bands and sticky bottom execution bars.
- **Data Entry Row Density**: Ledger line items employ strict, compact heights (36px standard rows, 44px editable input rows) using vertical padding of `0.375rem` to permit dense inspection of at least 25 entries per standard viewport fold.
- **Audit Strip Spacing**: Top overview summaries (Today's Sales, Collected, Pending, Cash-in-Hand) use uniform `1rem` gap modules to prevent visual crowding while keeping critical run-rates continuously pinned.

## Elevation & Depth

Visual hierarchy uses **tonal layer nesting** combined with **subtle hairline boundaries** rather than heavy blurred dropshadows, ensuring ledger sheets feel flat, precise, and crisp.

- **Level 0 (Floor Canvas)**: Textured workspace foundation in `#f8fafc`.
- **Level 1 (Surface Panel / Ledger Body)**: `#ffffff` containers framed with a 1px border of `#e2e8f0`. Shadow is strictly ambient: `0 1px 2px 0 rgba(15, 23, 42, 0.04)`.
- **Level 2 (Summary Ledger Cards & Dropdown Overlays)**: `#ffffff` elevated elements using 1px border `#cbd5e1` and a disciplined split shadow: `0 4px 6px -1px rgba(15, 23, 42, 0.06), 0 2px 4px -2px rgba(15, 23, 42, 0.04)`.
- **Level 3 (Modal Entry Sheets & Keyboard Palettes)**: Crisp floating state using border `#94a3b8` with `0 10px 15px -3px rgba(15, 23, 42, 0.08), 0 4px 6px -4px rgba(15, 23, 42, 0.03)`.
- **Active Ledger Row Focus**: Zero blur elevation; represented exclusively by a continuous 2px inner focus ring in `#2563eb` with a 4% tint overlay `#eff6ff` to support rapid keyboard row indexing (`j`/`k` navigation).

## Shapes

The design system implements a **Soft (Level 1)** geometric standard. Enterprise ledgers require rigid structural alignment where curved corners must never erode valuable data grid area or cause visual misalignment along vertical rules.

- **Base Radius (0.25rem / 4px)**: Input fields, table row action badges, numerical metric pills, and cell selection indicators.
- **Medium Radius (0.375rem / 6px)**: Standard buttons, date pickers, dropdown cards, and contextual tooltips.
- **Large Radius (0.5rem / 8px)**: Summary cards, primary ledger sheets, and modal transaction entry panels.
- **Pill Shape (`9999px`)**: Exclusively reserved for ledger reconciliation tags (e.g., `[VERIFIED]`, `[PENDING]`, `[RECONCILED]`) to visually differentiate metadata from data fields.

## Components

### Buttons
- **Primary Transaction Action**: Deep slate fill (`#0f172a`), white label, 0.375rem radius, height 36px (compact) or 40px (default). Active state deepens to `#020617`.
- **Secondary / Split Action**: White background, 1px border in `#cbd5e1`, slate label (`#1e293b`), hover background `#f1f5f9`.
- **Verified Action (Commit Entry)**: Emerald fill (`#059669`), white label, hover state `#047857`. Keyboard hotkey shortcut displayed in muted text (`Alt+S` or `Ctrl+Enter`).

### Data Entry Inputs & Table Cells
- **Ledger Input**: Single-line compact containers with 1px border `#cbd5e1`, background `#ffffff`. Focused state switches to 1.5px border `#2563eb` with zero outer shadow to prevent row blurring.
- **Rupee Prefix Group**: Prefixed with an integrated unbordered `₹` glyph in `#64748b` background-matched to the input. Inputs right-align automatically when typed as numeric.

### Status Chips & Verification Badges
- **Verified / Settled**: Background `#ecfdf5`, border `#a7f3d0`, text `#065f46`, uppercase font weight 700 with an integrated mini checkmark icon.
- **Pending / In-Transit**: Background `#fffbeb`, border `#fde68a`, text `#92400e`.
- **Variance / Overdue**: Background `#fef2f2`, border `#fecaca`, text `#991b1b`.

### Ledger Cards
- High-level metric panels featuring an upper metadata row (title + time range), a prominent Rupee balance displayed in `numeric-metric` with tabular styling, and a baseline change indicator. Encased in 1px `#e2e8f0` with a top 2px color-accent line indicating category (Emerald for Inflow, Amber for Suspense, Blue for Total Book).

### Fast-Entry Grid (Keyboard-Centric Component)
- Tabular ledger component supporting full arrow-key and Tab/Enter cell transitions.
- Header row pinned to slate navy (`#0f172a`) with contrasting silver labels (`#94a3b8`).
- Alternating subtle row striping (`#ffffff` and `#fcfdfd`).
- Right-aligned aggregate summary footer pinned to viewport bottom during scroll operations.