# Product Design Guidelines

## Product Feel

This product should feel like a quiet internal operating tool, not a marketing site and not a generic SaaS dashboard.

The interface should be compact, legible, calm, and built for repeated daily or weekly use. Prefer clarity and density over visual drama. The UI should help users scan information, make decisions, and continue their work without feeling overwhelmed.

## Layout

- Use a light gray page canvas with centered content.
- Keep the global header compact: logo, workspace context, user controls, and utilities are not hero content.
- Primary navigation should be small, pill-like, and understated.
- The active page or active tab should be clear, but not loud.
- Use white surfaces for real information groups.
- Avoid nested cards, decorative section containers, oversized hero blocks, and marketing-style split layouts inside the signed-in product.
- Preserve whitespace around major page blocks, while keeping repeated rows dense enough for scanning.
- Tab lists should size to their content and align left. Do not stretch tabs to full width unless the interaction truly needs it.

## Typography

- Keep typography small and purposeful.
- Page titles can be prominent; inner panels, cards, tables, and rows should use compact headings.
- Use short, direct product copy.
- Avoid explanatory marketing text inside the signed-in product.
- Use muted metadata text for secondary context such as time, owner, department, status, or category.
- Avoid viewport-scaled font sizes and negative letter spacing.

## Color

- Base palette: white surfaces, pale gray background, soft borders, near-black primary text.
- Use color as signal, not decoration.
- Status colors should stay small and attached to the relevant status, badge, row, or mode.
- Avoid dominant gradients, large color fields, decorative blobs, and one-note palettes.
- Prefer subtle hover and active states: border change, light background tint, or text weight is enough.

## Core Surfaces

### Login

- Center the login card on a gray canvas.
- Keep it narrow, quiet, and trust-oriented.
- Primary login action can be dark and full-width inside the card.
- Development, fallback, or diagnostic login should be secondary and collapsed by default.

### Header And Navigation

- Keep the wordmark small and precise.
- Utility controls should be compact and horizontally grouped.
- Important recurring actions should be easy to find, but should not dominate the page.
- Icon-only buttons should be visually aligned with neighboring controls and use clear accessible labels.
- Header controls should share a consistent visual centerline, spacing rhythm, border weight, and control height.

### Home

- Home should feel like a working start point, not a landing page.
- Keep common entrances visible near the top.
- Role-specific, mode-specific, or category-specific areas should be assembled from reusable sections.
- Use tabs when several sections compete for attention.
- The content panel under a selected tab should not repeat the selected tab title as a redundant heading.

### Dense List / Board Pages

- Treat list pages as operating boards.
- Keep search, filters, date or period navigation, summary counts, and key actions near the top.
- Group repeated items by meaningful categories when helpful.
- Rows or cards should expose enough context for scanning without requiring a deep drill-down.
- Prefer small status marks over large status banners in dense repeated lists.

### Detail Panels

- Use progressive disclosure for detail-heavy workflows.
- The panel's visual mode should be clear through a small banner, accent, or label.
- Keep read-only, editing, loading, and empty states calm and explicit.
- Avoid turning every sub-item into a separate decorative card.

### Settings

- Settings pages should feel administrative and quiet, not like a dashboard.
- Put the setting description and operational impact near the top.
- For permission or member management, keep the selectable list scrollable and keep the selected summary plus save action visible.
- Destructive or high-impact settings should be visually separated and require clearer confirmation.
- Save states should be explicit, but not noisy.

## Interaction

- Prefer tabs, segmented controls, accordions, drawers, popovers, and dialogs for progressive disclosure.
- Do not place every insight section on the page at once when only one needs attention.
- Buttons should be short and concrete.
- Use quiet secondary buttons for low-frequency actions.
- Empty, loading, and error states should be plain, actionable, and visually consistent.
- Hover and active states should not shift layout.
- Controls should remain stable in size when labels, icons, badges, or loading states change.

## Components

- Prefer accessible, behavior-focused primitives for complex controls: tabs, dialogs, popovers, dropdowns, selects, tooltips, switches, accordions, and collapsible sections.
- Use primitives to provide behavior, accessibility, focus management, keyboard handling, and component state.
- The product should own its visual styling through local design tokens, CSS, or the project's existing styling system.
- Avoid importing a full visual UI kit unless the product direction explicitly calls for it.
- Reused primitives should be wrapped as small product-styled components.
- One-off product-specific compositions should stay near the feature they serve.
- Icon buttons should use familiar symbols or a consistent icon set; avoid inconsistent system glyphs that render differently across platforms.

## Responsive Behavior

- Desktop can remain the primary working layout.
- On narrower screens, collapse the same hierarchy into one column.
- Avoid overlapping text or controls.
- Dense controls may scroll horizontally when needed, but should stay aligned with the content column.
- Fixed-format elements such as icon buttons, counters, tabs, and small blocks should have stable dimensions so hover or active states do not shift layout.
- Text should fit within its container on mobile and desktop. If needed, wrap, truncate, or reduce content density intentionally.

## Implementation Checklist

- Does the screen still feel like a compact internal workbench?
- Is color carrying status or mode information rather than decoration?
- Are secondary sections hidden behind tabs, accordions, drawers, or panels instead of expanded by default?
- Are labels and domain terms used consistently?
- Does the page avoid nested cards, oversized hero sections, and full-width tab bars where natural-width controls are enough?
- Are icon buttons aligned with neighboring controls and large enough to read?
- Are repeated rows dense enough to scan without feeling cramped?
- Are loading, empty, error, and saved states calm and actionable?
- If a complex control is needed, does it use accessible behavior while keeping product-owned styling?
