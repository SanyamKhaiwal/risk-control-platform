---
name: Risk & Control Assessment Platform
description: A modern risk ledger where residual risk is posted, never overwritten.
colors:
  ground: "#f4f6f5"
  sheet: "#ffffff"
  sheet-2: "#f0f3f1"
  rule: "#e0e5e2"
  rule-2: "#c6cecb"
  ink: "#111917"
  ink-2: "#44504c"
  ink-3: "#5f6b67"
  accent: "#1d5f52"
  accent-hover: "#164a40"
  accent-wash: "#e2eeea"
  red: "#b42318"
  red-wash: "#fbeae8"
  low-bg: "#e3f0e8"
  low-ink: "#1d5638"
  medium-bg: "#f6efd6"
  medium-ink: "#664c08"
  high-bg: "#fae2d2"
  high-ink: "#863710"
  critical-bg: "#f5d3cf"
  critical-ink: "#8b1a12"
typography:
  headline:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  figure:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  title:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.005em"
  body:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "cv11"
  dense:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
  label:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
  mono:
    fontFamily: "Geist Mono Variable, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "0.92em"
    letterSpacing: "-0.01em"
rounded:
  sm: "4px"
  md: "6px"
  lg: "4px"
  pill: "11px"
spacing:
  s-1: "4px"
  s-2: "8px"
  s-3: "12px"
  s-4: "16px"
  s-5: "24px"
  s-6: "32px"
  s-7: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "34px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "34px"
  button-secondary-hover:
    backgroundColor: "{colors.sheet-2}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    height: "34px"
  button-danger:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.red}"
    rounded: "{rounded.md}"
    height: "34px"
  button-sm:
    height: "28px"
    padding: "0 10px"
    typography: "{typography.label}"
  input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
    height: "34px"
  badge-rating-low:
    backgroundColor: "{colors.low-bg}"
    textColor: "{colors.low-ink}"
    rounded: "{rounded.pill}"
    height: "22px"
    padding: "0 8px"
  badge-rating-medium:
    backgroundColor: "{colors.medium-bg}"
    textColor: "{colors.medium-ink}"
    rounded: "{rounded.pill}"
    height: "22px"
  badge-rating-high:
    backgroundColor: "{colors.high-bg}"
    textColor: "{colors.high-ink}"
    rounded: "{rounded.pill}"
    height: "22px"
  badge-rating-critical:
    backgroundColor: "{colors.critical-bg}"
    textColor: "{colors.critical-ink}"
    rounded: "{rounded.pill}"
    height: "22px"
  sheet:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.lg}"
  sheet-head:
    padding: "12px 16px"
    height: "52px"
  topbar:
    backgroundColor: "{colors.sheet}"
    height: "56px"
    padding: "0 24px"
  segmented-selected:
    backgroundColor: "{colors.ink}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    height: "28px"
---

# Design System: Risk & Control Assessment Platform

## Overview

**Creative North Star: "The Modern Ledger"**

A risk register kept like a ledger, not a dashboard template. Figures are posted, never silently overwritten: when a residual score changes, the old figure is struck through (in red ink when the movement is adverse, in quiet ink when it improves) and the new one is posted beside it, on the heat-map cells and in every row that shows a score. The rest of the system stays quiet so that one movement reads.

The world is a cool, bright ground with white sheets divided by 1px rules. There are no cards-with-shadows, no gradients, no dark mode (light only, chosen for office desktops and projectors in bright rooms). One sans (Geist) carries everything with tabular figures; one ledger-green accent marks actions, the current location and focus; red ink is reserved for adverse movement and destructive actions; four pale rating washes are always paired with the rating word or score. Density is high and fixed: a practitioner scans both 5x5 matrices and the register without scrolling through chrome.

**Key Characteristics:**
- Light-only, flat, ruled: depth comes from tonal layers and 1px rules, not shadows.
- One sans family with tabular numerals; mono only for hashes and event ids.
- One accent (green) for action; red only for adverse; rating washes never stand alone.
- One authored motion: posting a figure. Everything else is a 150ms state fade.

## Colors

A cool green-grey neutral system with one deep green accent, one red ink, and four rating washes.

### Primary
- **Ledger Green** (accent): primary buttons, active-nav underline, the live dot, checkbox accent, the focus ring (3px at 28% alpha), the "Effective" result badge. Its hover is **Deep Ledger Green** (accent-hover). **Ledger Wash** (accent-wash) tints success notices and the row flash after a posting.

### Secondary
- **Red Ink** (red): the strike through a superseded figure when the movement is adverse, the re-test count pill in the nav, field errors, invalid input borders, danger-button text. **Red Wash** (red-wash) backs error notices, the "Ineffective" badge and danger-button hover.

### Tertiary: rating washes
- **Low** (low-bg / low-ink), **Medium** (medium-bg / medium-ink), **High** (high-bg / high-ink), **Critical** (critical-bg / critical-ink): pale background plus a dark same-hue ink, used on matrix cells, rating badges and the legend. Medium also tones the "Partially effective" result badge. Empty matrix cells mix the wash 42% into white so the zone stays visible but recedes.

### Neutral
- **Cool Ground** (ground): page background behind sheets.
- **Sheet White** (sheet): sections, top bar, inputs, login panel.
- **Second Sheet** (sheet-2): table heads, row hover, secondary-button hover, skeletons, info notices, avatars.
- **Hairline** (rule): every divider and sheet border. **Firm Rule** (rule-2): input, button and neutral-badge borders.
- **Ink** (ink), **Ink 2** (ink-2: labels, secondary copy), **Ink 3** (ink-3: meta, table heads, axis labels; the lightest text allowed on white, about 5:1).

### Named Rules
**The One Voice Rule.** Ledger Green appears only on things you can act on, the current nav item, focus and the live/effective signals. Never as decoration or a heading colour. Selection inside a control (segmented option, matrix cell) is solid ink, not green.

**The Red Ink Rule.** Red marks adverse risk movement, failures and destructive actions. It never decorates.

**The Word-With-Wash Rule.** A rating colour never appears without its rating word or numeric score beside or inside it.

## Typography

**Body Font:** Geist Variable (fallback ui-sans-serif, system-ui, Segoe UI)
**Label/Mono Font:** Geist Mono Variable (fallback ui-monospace, Cascadia Mono, Consolas), used only for hashes and event ids.

**Character:** One neutral grotesque at a fixed rem scale (ratio about 1.15 to 1.25, not fluid); hierarchy comes from weight 600 against 400/500 and tight negative tracking on large figures. Body uses `cv11`.

### Hierarchy
- **Headline** (600, 1.5rem, 1.25, -0.015em): page title (h1) only.
- **Figure** (600, 1.75rem, -0.02em, tabular): the likelihood x impact = score equation on risk detail. Matrix cell counts use 600 at 1.375rem.
- **Title** (600, 1rem, 1.25): sheet titles (h2). h3 is 600 at 0.875rem.
- **Body** (400, 0.875rem, 1.5): default UI text. Long descriptions cap at about 68ch.
- **Dense** (0.8125rem): tables, buttons, inputs, notices, breadcrumbs, sheet subtitles.
- **Label** (500, 0.75rem, sentence case): table column heads, badges, hints, axis titles, legend, small buttons.

### Named Rules
**The Tabular Rule.** Every number that can change or be compared (scores, counts, pager totals, axis numbers) is set with tabular figures and right-aligned in tables.

**The Sentence-Case Rule.** Labels and table heads are sentence case at 500 weight; nothing is set in tracked uppercase (the avatar initial is the only uppercase).

## Layout

- Single column under a sticky 56px top bar (wordmark, horizontal nav, demo tag, user). No sidebar.
- Page container max 1440px, padding 32px top / 24px sides / 48px bottom, sections stacked with a 24px gap.
- Spacing scale 4 / 8 / 12 / 16 / 24 / 32 / 48px. Sheets pad 16px; sheet heads 12px 16px at min 52px; table cells 10px 12px (16px at the outer edges), heads 8px 12px.
- Two-up grids: matrices side by side (two equal columns, 24px gap); detail pages are content plus a 300 to 380px side column.
- Breakpoints: 1100px hides tertiary table columns; 1000px collapses two-up grids to one column; 900px stacks the login split; 760px hides secondary columns, the wordmark text, user name and demo tag, tightens page padding to 24px / 16px, and stacks the score equation.
- Tables scroll horizontally inside their sheet rather than reflowing.

## Elevation & Depth

Flat. Depth is tonal (ground, sheet, sheet-2) and ruled (1px hairlines). No surface carries a resting shadow. Box-shadow is used only for state: the focus ring (`0 0 0 3px rgb(29 95 82 / 0.28)`) and inset outlines on matrix cells (1px band-ink at 45% on hover, 2px ink when selected, a 2px band-ink plus 4px wash halo during a posting).

### Named Rules
**The Rules-Not-Shadows Rule.** Sections separate by 1px rules and tonal layers. A shadow means focus or state, never altitude.

## Shapes

Gently rounded, small radii: 4px (sheets, account list, segmented options, demo tag), 6px (buttons, inputs, notices, matrix cells). Badges are full pills (11px on 22px height); the nav count pill and avatar are round. The active-nav underline is a 2px bar with 2px top corners. Borders are always 1px; the dashed border is used only for the "demo data" tag.

## Components

### Posted figure (signature)
The one authored motion. When a score changes: a strike draws across the old figure left to right (red when adverse: a higher score, more risks in a High or Critical cell, or lower effectiveness; ink-2 otherwise) (280ms, `cubic-bezier(0.16, 1, 0.3, 1)`); the new figure rises 0.3em in from a 2px blur (360ms, 220ms delay); the old figure fades out at 1.7s; the whole posting clears at 2.1s. The containing table row washes in accent-wash and fades over 2.4s; a matrix cell pulses an inset band-ink outline over 2.2s. Screen readers get "(was N)". Under `prefers-reduced-motion` all animation collapses to near-zero duration. Used in matrix cells, risk table rows, control-linked risk rows and the residual equation.

### Buttons
- **Shape:** 6px radius, 34px tall, 14px side padding, 0.8125rem / 500.
- **Primary:** Ledger Green fill, white text; hover Deep Ledger Green.
- **Secondary (default):** white with Firm Rule border; hover Second Sheet.
- **Ghost:** transparent, ink-2; hover Second Sheet and ink. **Danger:** red text on white, pale red border; hover Red Wash.
- **Small:** 28px, 10px padding, 0.75rem. **Active:** 0.5px press. **Disabled:** neutral sheet-2 fill, rule border, ink-3 text, not-allowed. **Busy:** 14px spinner, progress cursor.

### Badges
22px pill, 0.75rem / 500. Rating badges use their wash and ink and carry the word plus optional score. Status uses a neutral outlined pill (closed is Second Sheet, ink-3). Assessment results: Effective = accent, Partially effective = medium, Ineffective = red wash.

### Sheets
White, 1px hairline border, 4px radius. Head: title (h2) with optional subtitle in ink-3, actions right-aligned, hairline below. Optional toolbar row (filters) under the head; pager row above a hairline at the foot.

### Ledger table
Full-width, collapsed borders, 0.8125rem. Head row on Second Sheet in label style; rows divided by hairlines; numbers right-aligned tabular; clickable rows hover to Second Sheet. Primary cell stacks a 500-weight link over a 0.75rem ink-3 sub-line.

### Inputs / Fields
- **Style:** white, Firm Rule border, 6px radius, min 34px; select uses a drawn chevron; textarea min 72px.
- **Hover:** border to ink-3. **Focus:** border Ledger Green plus focus ring.
- **Error:** red border and a 0.75rem red message under the field. Labels are 0.8125rem / 500 ink-2 above; hints 0.75rem ink-3.
- **Segmented control:** radio group in a bordered 6px track; selected option is solid ink with white text.

### Navigation
Top-bar links in ink-3 / 500, hover and current to ink; current carries a 2px Ledger Green underline sitting on the bar's bottom rule. A red count pill flags the re-test queue. Overflow scrolls horizontally on narrow screens.

### Risk matrix
5x5 grid of 16:9 cells (min 48px), 4px gutters, 6px radius, rating wash fill. Score sits small at top-left in band ink at 62%; count centred at 1.375rem / 600. Legend of 12px swatches with words below. Interactive cells outline on hover; selected cells take a 2px ink inset.

### Notices and states
Notices: 6px radius, 10px 12px padding, 16px line icon; info on Second Sheet, error on Red Wash, success on Ledger Wash. Empty states are centred ink-3 text with an ink title and optional button. Loading uses Second Sheet skeleton bars pulsing to 55% opacity over 1.4s. The live indicator is a 7px green dot, grey when stale.

## Do's and Don'ts

### Do:
- **Do** use the posted-figure treatment for any score or count that changes live; it is the system's only authored motion.
- **Do** pair every rating wash with its word or score, in cells, badges and the legend.
- **Do** separate content with 1px `rule` hairlines and the ground / sheet / sheet-2 layers.
- **Do** set changeable numbers tabular and right-aligned.
- **Do** keep transitions on hover and focus to 150ms colour, border or shadow fades.
- **Do** mark synthetic data with the dashed "demo data" tag.

### Don't:
- **Don't** add resting shadows, gradients, glows or a dark theme.
- **Don't** use Ledger Green for anything that isn't an action, the current location, focus or a positive result.
- **Don't** use red for decoration or neutral emphasis.
- **Don't** add a sidebar, stat-card rows or chart widgets; the matrices and ruled tables are the dashboard.
- **Don't** introduce a second display or text face; Geist Mono stays limited to hashes and ids.
- **Don't** set labels in tracked uppercase.
