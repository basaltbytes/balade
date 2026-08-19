---
name: balade
description: The review app's visual system — GitHub Primer dark, expressed as Tailwind theme tokens
colors:
  background: "#0c0c0d"
  foreground: "#f3f3f6"
  card: "#18191b"
  card-foreground: "#f3f3f6"
  popover: "#18191b"
  popover-foreground: "#f3f3f6"
  primary: "#5279ff"
  primary-foreground: "#0c0c0d"
  secondary: "#232326"
  secondary-foreground: "#d0d1d5"
  muted: "#232326"
  muted-foreground: "#919298"
  accent: "#232326"
  accent-foreground: "#f3f3f6"
  destructive: "#fe5650"
  border: "#333336"
  border-soft: "#212225"
  input: "#333336"
  ring: "#5279ff"
  added: "#44c759"
  modified: "#e7ac2a"
  removed: "#fe5650"
  context: "#797a7f"
  done: "#b17eff"
  open: "#1aae54"
  accent-muted: "#89c3ff"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans, Helvetica, Arial, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans, Helvetica, Arial, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans, Helvetica, Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans, Helvetica, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.3
  code:
    fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: "20px"
rounded:
  xs: "2px"
  inline: "4px"
  md: "6px"
  lg: "10px"
  sheet: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  section: "48px"
components:
  chip-neutral:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.md}"
    padding: "2px 7px"
    typography: "{typography.label}"
  chip-status:
    backgroundColor: "{colors.added}"
    textColor: "{colors.added}"
    rounded: "{rounded.md}"
    padding: "2px 7px"
    typography: "{typography.label}"
  button-mark:
    backgroundColor: "{colors.background}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.md}"
    padding: "5px 12px"
  button-mark-reviewed:
    backgroundColor: "{colors.added}"
    textColor: "{colors.added}"
    rounded: "{rounded.md}"
    padding: "5px 12px"
  button-toggle:
    backgroundColor: "{colors.background}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.md}"
    padding: "3px 8px"
  button-toggle-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "3px 8px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.lg}"
    padding: "16px"
  codeblock:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
  codeblock-header:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.secondary-foreground}"
    padding: "8px 12px"
  input-textarea:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  nav-item:
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.md}"
    padding: "5px 8px"
  nav-item-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "5px 8px"
---

# Design System: balade

## Overview

balade is a walkthrough reader for pull requests too large to scan, and the
surface is built around one commitment: a reviewer who already reads code on
GitHub must need no orientation here. The layout, the Octicons, the PR header,
the diff semantics and the file browser all come from that habit and stay.

Everything else is balade's own. The ground is a near-neutral dark — chroma
stays under 0.006 on every surface step — so the syntax and diff colors are the
only chromatic things on the page. There is one blue accent, deeper and more
saturated than the platform blue it replaced, and five status hues that mean
exactly one thing each.

The page runs at two densities on purpose. Evidence is packed: code at 12.5px
over a 20px grid, file rows at 7px of vertical padding, nav labels at 11px.
Explanation is not: authored prose runs at 15px over 1.7, capped at 72
characters, while the code and diffs beside it keep the full column. A
walkthrough is read for an hour, and instrument labels do not survive that
length as body text.

Structure is flat. One tonal step separates page from card; 1px borders do the
dividing; a shadow means the element has genuinely left the document plane. The
one piece of geometry that is neither borrowed nor structural is the rail: a
continuous line down the left margin with a node at every section, filling as
sections are marked reviewed. It states progress as position rather than as a
count, and it is the product's own metaphor rather than an ornament.

**Key Characteristics:**
- One token block, one source of truth (`app/src/theme.css` `@theme`).
- A near-neutral ground; color on the page always means something.
- Seven domain colors, seven meanings, zero decorative color.
- Two densities: packed evidence, unhurried explanation.
- Flat surfaces; borders and one tonal step do the separating.
- Monospace for anything that literally exists in the repository.
- Octicons only, from a fixed 48-name map the renderer owns.
- No external assets of any kind — the CSP forbids them.

## Colors

Every text token clears 4.5:1 against both `background` and `card`.

### Primary
- **Signal Blue** (`#5279ff`): the single interactive accent. Active nav item,
  focused input border, hover border on every outlined control, progress fill,
  selected view in the code block's segmented control, the `mark=` highlight
  bar, the active rail node, and text selection. Also `ring`. Nothing else is
  blue.
- **Reference Blue** (`#89c3ff`): read-only reference text, not an affordance —
  commit SHAs, method signatures, attribute pills, renamed-file status, diff
  hunk headers. It looks like a link and never is one.

### Secondary
The status hues. Each carries one meaning and appears nowhere else.

- **Added Green** (`#44c759`): additions, added files, completed review state,
  passing assertions, a filled rail node, the progress bar at 100%.
- **Modified Amber** (`#e7ac2a`): modified files, staleness warnings, the
  `expect` mismatch notice, the fallback-persist badge.
- **Removed Red** (`#fe5650`): deletions, deleted files, validation errors. Same
  value as `destructive`; one color with two jobs.
- **Context Grey** (`#797a7f`): a zero count. A file with no deletions renders
  its `−0` in this, not in red.
- **Merged Violet** (`#b17eff`): merged PR state, test and method chips, the
  beaker icon. The "already settled" color.
- **Open Green** (`#1aae54`): the open-PR badge only. Deeper and more saturated
  than Added Green because it fills a solid pill; that pill takes `background`
  as its text color, not white.

### Neutral
An eight-step ramp, dark to light, at near-zero chroma.

- **Page** (`#0c0c0d`): the document plane, and the code block's own background —
  excerpts sit *in* the page, not on a card.
- **Card** (`#18191b`): the one step up. Cards, method and test blocks, untoned
  callouts, popovers, diagram frames.
- **Muted / Secondary / Accent** (`#232326`): all three slots resolve to one
  value. Code block headers, chip fills, the question bubble in a thread, nav
  hover.
- **Soft Divider** (`#212225`): row dividers inside dense lists.
- **Border** (`#333336`): every structural 1px line. Also `input`.
- **Metadata Grey** (`#919298`): metadata, line numbers, directory segments,
  timestamps, icon defaults.
- **Reading Grey** (`#d0d1d5`): body prose and control labels. Most running text
  is this, not `foreground`.
- **Heading White** (`#f3f3f6`): headings, file names, emphasis.

### Named Rules

**The Meaning Rule.** A status color is applied because the content *is* that
status, never because a surface needs visual interest. If you cannot name the
status, use the neutral ramp.

**The Quiet Ground Rule.** Surfaces stay under 0.006 chroma. The page is
deliberately colorless so that syntax highlighting and diff state are the only
things competing for the eye. A tinted surface is a status signal, not a mood.

**The Alpha Ladder Rule.** Tinted surfaces use fixed alpha steps, and only
these: text at 100%, fills at 9–14% (`/10` banners and active states, `/12`
chips, `/14` the active nav item, 9% the diff add and delete washes), borders at
30–50% (`/32` chips, `/40`–`/50` banners and active states), diff line-number
gutters at 20% and their highlights at 26%. A new tinted surface picks a rung;
it does not invent one.

**The Two-Job Red Rule.** `destructive` and `removed` are the same hex on
purpose. Deletion and failure read identically — both mean "this is gone or
broken."

**The Blue-Is-Action Rule.** `#5279ff` marks something you can act on or are
currently on. `#89c3ff` marks something to read. Never swap them.

## Typography

**Body Font:** system UI stack (`-apple-system, BlinkMacSystemFont, "Segoe UI
Variable Text", "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif`)
**Mono Font:** `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
"Liberation Mono", monospace`

Both are OS stacks. No webfont is loaded, and none can be: the served CSP is
`default-src 'none'` with no font source, and the export must stay one file.

### Hierarchy
- **Page** (600, 28px, -0.025em): the PR title. One per page.
- **Section** (600, 24px, -0.02em): section titles, beside an Octicon, on the
  rail. No underline — the rail and the space do the separating.
- **Panel Title** (600, 17px): the clarification drawer heading.
- **Title** (600, 17px, -0.01em): `###` headings inside authored prose, with
  32px above and 8px below.
- **Body** (400, 15px, 1.7): authored prose, list items. Capped at 72ch.
- **Base** (400, 14.5px, 1.5): chrome text that is not prose.
- **Card / Meta** (400, 12–13.5px): card bodies, header statistics, file rows.
- **Label** (400, 11–11.5px): chips, tags, nav group headers, counts.
- **Code** (400, 12.5px / 20px): excerpts and diffs. Inline code is `0.92em`,
  inline mono spans `0.95em` — relative, so they track their host text.

### Named Rules

**The Two-Density Rule.** Prose is capped at 72ch and set at 15px/1.7; evidence
keeps the full column at its own tighter scale. The two never converge — packing
the explanation to match the diff is how the old scale went wrong.

**The Repository-Truth Rule.** Monospace means the string exists verbatim in the
repository or in git: file paths, identifiers, line ranges, commit SHAs,
diagnostic codes, section ids, `expect` quotes. Prose about those things is
sans.

**The Muted-Directory Rule.** A file path renders its directory in
`muted-foreground` and its basename in `foreground`.

**The Tabular Rule.** Every count that updates in place uses `tabular-nums` so
the layout does not shift as it changes.

## Layout

A two-column reading layout inside a 1280px container. The left column is a
fixed 268px sticky nav, independently scrolling; the right is the document,
`flex-1` and capped at 960px, with a 32px gutter. Side padding is 16px below
`sm` and 24px above.

Vertical rhythm: 32px page padding, 64px between sections, 40px between the
header block and the first section, 16px between blocks inside a section. The
document column is inset 34px from the left to carry the rail.

**Below `md` (768px)** the sidebar has nowhere to go, so its two jobs split. A
fixed bottom bar — thumb-reachable, 44px targets, `env(safe-area-inset-bottom)`
padding — carries the progress line flush along its top edge, the section count,
and next-unreviewed. The full tree opens from it as a sheet: progress, both
review toggles, clarifications, every section and file. Nothing the wide layout
offers is unreachable. The rail narrows to a 22px inset, card and test grids go
to one column, the change bar drops off file rows below `sm`, and the split diff
becomes unified — two code columns do not fit one phone.

### Named Rules

**The Nothing-Dropped Rule.** The compact viewport relocates controls; it never
removes them. A control that exists at 1280px is reachable at 375px.

**The Sticky-Nav Rule.** On the wide layout the nav scrolls independently and
never leaves. It is the reader's position instrument on a document that can run
to hundreds of screens.

**The 24px Anchor Rule.** Every `section[id]` carries `scroll-margin-top: 24px`
so an in-page jump never lands flush against the viewport edge.

## Elevation & Depth

The system is flat. Depth comes from a single tonal step (`#0c0c0d` page →
`#18191b` card) and 1px borders, with `#212225` as the soft divider inside dense
lists. There is no shadow scale and no lift on hover.

Shadow appears only where the element has genuinely left the document plane: the
clarification drawer and the section sheet, the selection "Ask agent" button
floating over highlighted text, and the thread hover popover. Both overlays lay
a black scrim over the page.

### Named Rules

**The Flat-Plane Rule.** A shadow means the element is not part of the document.
Cards, code blocks, banners, and file rows are all in the plane and take none.
If a new surface wants a shadow, the real question is whether it should be a
card at all.

**The One-Step Rule.** There is one tonal step, not a ramp. A surface is either
page or card. Nesting a card inside a card produces no third value — use a
border.

### Motion

Motion is near-absent and deliberate about it. Five things move: the progress
bar's width over 200ms, a rail node's color as a section is marked, the
pending-clarification spinner, the diagram's opacity transitions on hover, and
the smooth scroll on in-page jumps — which already degrades correctly, falling
back to an instant jump when the browser has smooth scrolling disabled.

**The Silent-Page Rule.** Nothing animates on load, on scroll, or on entrance.
Motion responds to a state change the reader caused, or it does not exist.

None of the five respect `prefers-reduced-motion`. That is a WCAG 2.2 AA gap,
not a style.

## Shapes

Rectangular, with two radii and a rule that assigns them.

- **Controls take `md` (6px):** chips, buttons, the segmented control, nav items,
  inputs, tags.
- **Containers take `lg` (10px):** cards, code blocks, banners, callouts, tables,
  the file browser, diagram frames, method and test blocks.

Three deliberate exceptions: inline code at 4px, small enough that 6px would
read round; the change-bar squares at 2px; and the section sheet at 16px on its
top corners, the only surface that arrives from off-screen. Pills — the PR state
badge, the thread-count indicator, the progress bar, the sheet's grab handle —
are fully round.

Borders are always exactly 1px and always a solid token color. One place breaks
it, to signal state: the 2px inset bar on a highlighted code line, in `primary`.

### Named Rules

**The Two-Radius Rule.** If it is a thing you press, it is 6px. If it is a thing
that holds content, it is 10px. There is no third answer, and a container does
not get its own number because it happens to be large.

**The 1px Rule.** Structure is 1px. A thicker border is a state signal, never
emphasis or decoration.

**The Full-Bleed Wash Rule.** A surface whose background states something about
the content — a diff wash, a highlighted line — owns its container edge to
edge. Padding that frames it in the container's own color reads as a mistake.
Move the padding onto the washed element.

**The No-Stub Rule.** Active state is carried by fill and text weight, not by a
colored bar clipped into a rounded corner. A 2px accent border on a rounded
list item reads as a template, not as a decision.

## Components

### Chips
- **Shape:** 6px radius, 2px × 7px padding, 11px, `whitespace-nowrap`, optional
  12px leading Octicon.
- **Tones:** six — neutral, new, mod, del, key, done. Each is text at full value,
  fill at 12%, border at 32%. Neutral is the exception: solid `secondary` fill.

### Buttons
- **Shape:** 6px radius, 1px `border` at rest, no fill.
- **Default:** `secondary-foreground` text; on hover, text to `foreground` and
  border to `primary`. That border shift is the app's universal hover.
- **Active:** `primary/10` fill, `primary/50` border, `foreground` text.
- **Disabled:** `opacity-40` or `opacity-50` with `cursor-not-allowed`.
- **Mark reviewed:** the one semantic button. Unreviewed is an outline button
  with a check; reviewed switches to `added` text, `added/40` border, `added/10`
  fill and a filled check-circle. Its compact form carries a `-m-2 p-2` hit area
  so a 13px icon is still a touch target.

### Cards / Containers
- **Corner:** 10px. **Background:** `card`, 1px `border`, 16px padding.
- **Shadow:** none, per the Flat-Plane Rule.
- **Variants:** plain card, method block (mono signature in reference blue with
  a violet decorator), test block (beaker, mono name, assertion list with green
  checks), pattern block (icon rail on the left).

### Inputs
- **Textarea:** `background` fill, 1px `border`, 6px radius, 13px, `resize-y`.
  Focus switches the border to `primary` — the same signal as button hover.
- **Checkbox:** the native control with `accent-color: primary`.
- **Caret:** `primary`, everywhere text is entered.

### Navigation
- **Item:** 5px × 8px, 6px radius. Active takes a `primary/14` fill and
  `font-medium`; hover on an inactive item is `secondary/60`. No accent border.
- **Group header:** 11px uppercase, `tracking-wide`, `muted-foreground`.
- **Header block:** progress count, a 3px progress bar, then next-unreviewed and
  hide-reviewed, over a bottom rule.
- **Compact:** a fixed bottom bar plus a section sheet. See Layout.

### The Rail
The signature. A 1px line down the document's left margin, fading out over the
last 96px, with a 9px node at every section head ringed 4px in the page color so
the line passes behind it. A node is `border` by default, `primary` while its
section is the active one, and `added` once the section is marked reviewed. It
is the only place in the app where progress is shown as position.

### Code Excerpt
A 10px-radius bordered block on the page background, with a `muted` header
carrying a collapse chevron, the monospace file path, the line range, a GitHub
deep-link, and a three-way segmented control. Line numbers are CSS counters
seeded from `--ln-start` so numbering matches the file, not the excerpt; the
gutter is sticky so it survives horizontal scroll. The block's vertical
breathing room is carried by the first and last line rather than the `pre`, so
a washed excerpt reaches the block's edges instead of being framed by a bare
strip. Added lines take a 9% `added`
wash and a `+` in the gutter. Authored `mark=` lines take a 10% `primary` wash
and a 2px inset bar. The block caps at 520px and scrolls internally.

### File Browser
One row per changed file: chevron, status icon, monospace path, an optional
jump-link to the discussing section, `+n` green, `−n` red or `context` when
zero, a five-square change bar (hidden below `sm`), and a Viewed checkbox.
Expanding reveals the full unified or split diff.

### Overlays
- **Clarification drawer:** a right sheet, `max-w-[620px]`, over a 35% scrim,
  sticky header with the mono section id.
- **Section sheet:** a bottom sheet below `md`, `max-h-[82vh]`, 16px top
  corners, grab handle, scrim, closing on Escape, on the scrim, and on any jump
  inside it.

### Banners
1px border at 50%, fill at 10%, a tone-colored icon, a 13.5px semibold title,
13px body, optional dismiss. Four tones. Toned callouts render through this
same shape.

## Do's and Don'ts

### Do:
- **Do** add any new color to the `@theme` block in `app/src/theme.css` first.
  A hex literal in a component is a bug.
- **Do** pick an existing rung on the alpha ladder when tinting a new surface.
- **Do** use 6px for controls and 10px for containers.
- **Do** use monospace for any string that exists verbatim in the repository or
  in git, and sans for prose about it.
- **Do** use `border-primary` on hover and `bg-primary/10` on active for every
  outlined control.
- **Do** take icons from the map in `app/src/ui/octicon.tsx`.
- **Do** put every user-visible string in `app/src/i18n.ts` in both `en` and
  `fr`, and check the layout against the French string, which runs longer.
- **Do** give any control that ships as a bare icon a padded hit area.

### Don't:
- **Don't** use a status color for anything but its status. There is no
  decorative green.
- **Don't** raise surface chroma. The ground is quiet so the code is not.
- **Don't** add a shadow to anything that stays in the document plane.
- **Don't** introduce a third tonal surface value.
- **Don't** put a colored border on the edge of a rounded item to mark state.
  Fill and weight carry it.
- **Don't** load a webfont, an icon font, a remote image, or any external asset.
- **Don't** let prose exceed 72ch or compress below 15px, and don't cap the
  evidence beside it to match.
- **Don't** remove a control on the compact viewport. Relocate it.
- **Don't** add motion without `prefers-reduced-motion` handling. PRODUCT.md
  commits to WCAG 2.2 AA and the app has none today — including for the five
  animations already shipping.
