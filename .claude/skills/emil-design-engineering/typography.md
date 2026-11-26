# Typography

Rules for text on the web: font files and loading, variable fonts and OpenType features, type scales, leading and tracking, line length, wrapping and truncation, underlines, selection, form text, smoothing, contrast floors, and punctuation, plus a CSS-to-Tailwind lookup. Read it when choosing or wiring up fonts, building a type scale, fixing text that wraps, truncates, or jitters, or auditing typography in a codebase. Context decides which rule applies: a data cell, a hero headline, a form hint, and an essay paragraph each get their own treatment.

Write every fix in the project's existing styling idiom. The [Tailwind lookup](#css-to-tailwind-lookup) at the end translates each declaration. No typography fix requires a new typeface; only swap or add a face when the task asks for one.

## Typefaces

### Families and pairing

- **Sans-serif** is the default for product UI: uniform strokes that hold up small. **Serif** suits essays and editorial reading. **Monospace** gives every glyph one width, for code, diffs, and IDs. **Display** faces are drawn to be seen big and are usually too spindly or quirky for paragraphs. **Script** is a rare garnish.
- **Two typefaces cover most products; three is the ceiling.** Every added face, weight, and size dilutes hierarchy. Marketing pages get more latitude than app UI.
- **Pair for the register first.** In product UI and docs, start with one sans plus a mono: the sans carries headings through size and weight, and the work is fitting the mono to it by eye (`0.875em` is a starting point, not a guaranteed x-height match). A serif heading over a sans body works when the register calls for that voice and the serif still clearly leads at its size.
- **Wrong:** two lookalike sans-serifs (two humanists, two grotesques). **Right:** contrast in classification, or one family. Lookalikes read as an accident.
- **Match the optical cut to the size.** Families like Freight ship Text, Display, and Big cuts. Text has sturdier strokes and looser fit for paragraphs; Big has hairline contrast that only resolves at poster scale.
- **Light weights are size-dependent.** Illegible at 11px, elegant at 32px. Never set light weights small.
- **Italic is for citations and linguistic stress; bold is for UI emphasis.** Italic as UI hierarchy is a publishing convention in the wrong medium.

### Why equal sizes look unequal

`font-size` sets the em box, not any visible letter. Each face picks its own x-height, cap height, ascenders, and descenders, so a large-x-height face reads bigger than a small-x-height face at the same declared size. After pairing or swapping families, compare faces at their assigned sizes and retune until the heading clearly wins. This is also why an unmatched fallback jolts the layout when the webfont arrives.

### Font stacks

```css
/* Native feel: hand rendering to the OS */
body { font-family: system-ui, sans-serif; }

/* Brand face with fallbacks of similar proportions */
body { font-family: "Graphik", "Helvetica Neue", Arial, sans-serif; }
```

Always declare a fallback stack chosen to match the webfont's x-height and weight.

## Files and loading

- **Ship `woff2` only.** It carries Brotli compression and every current browser supports it. `woff` only for genuinely ancient browser requirements. `ttf`/`otf` in `public/fonts` is a bug: they are uncompressed desktop formats.
- **Load only the weights you use.** Eight weight/style files when three are used adds page weight and delays render for nothing. With one or two weights, static files are often smaller; with many weights, an `opsz` axis, or custom axes, a variable file wins.
- **Subset.** Strip glyphs the site never renders (unused scripts, languages, symbols). For multilingual sites, split files by script and serve them with `unicode-range` so each page downloads only what it needs.
- **Preload above-the-fold fonts** so they arrive sooner:

```jsx
import { preload } from 'react-dom';

preload('/fonts/inter-var.woff2', {
  as: 'font',
  type: 'font/woff2',
  crossOrigin: 'anonymous',
});

// <link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin />
```

`crossorigin` is required even for same-origin fonts, or the preload is fetched twice.

- **Preloading shortens the fallback window; it doesn't remove the swap.** To stop text reflowing when the webfont lands, match the fallback's metrics with `size-adjust`, `ascent-override`, and `descent-override` on a fallback `@font-face`. `next/font` does this automatically.

```css
@font-face {
  font-family: "Inter Fallback";
  src: local("Arial");
  size-adjust: 107%;
  ascent-override: 90%;
}

body { font-family: "Inter", "Inter Fallback", sans-serif; }
```

- **Forbid synthesized styles.** A requested bold or italic that was never loaded gets faked by thickening or slanting glyphs. Set `font-synthesis: none` on `html` so a missing file shows up as an obvious regression.

## Variable fonts and OpenType

### Axes

A variable font packs a continuous design space into one file, so `font-weight: 473` renders a real 473. Registered axes: `wght` (weight), `wdth` (width), `opsz` (optical size), `slnt` (slant), `ital` (italic). Anything else is a custom axis in uppercase, such as Fraunces' `SOFT` and `WONK`. A font exposes only the axes it was built with.

### Use the property, not the raw tag

High-level properties degrade sensibly when a fallback font renders. Raw tags silently do nothing.

```css
/* Right */
.masthead {
  font-weight: 620;
  font-optical-sizing: auto;
}

/* Right: custom axes and numbered sets have no property */
.pull-quote { font-variation-settings: "SOFT" 80; }
.wordmark { font-feature-settings: "ss02" 1; } /* ss02 in this font: single-story a */

/* Wrong: fallback fonts ignore this */
.masthead { font-variation-settings: "wght" 620; }
.price { font-feature-settings: "tnum" 1; }
```

### Useful features

- `tnum` tabular figures → `font-variant-numeric: tabular-nums`
- `lnum` / `onum` lining vs old-style figures → `lining-nums` / `oldstyle-nums`
- `zero` slashed zero → `slashed-zero`
- `frac` diagonal fractions → `diagonal-fractions`
- `liga` standard ligatures → `font-variant-ligatures`
- `ss01`–`ss20` stylistic sets, `cv01`–`cv99` character variants → `font-feature-settings` only

Stylistic-set numbers are arbitrary slots: `ss01` does something different in every family. Check the foundry's specimen before enabling one and leave a comment saying what it does in this font.

**Small caps:** `font-variant-caps: small-caps` for real drawn small caps, never shrunken uppercase. **Superiors/inferiors:** `font-variant-position: super` / `sub` for genuine glyphs (m², CO₂). Both need the glyphs to exist in the font; verify first. The default `<sup>` is too large and pushes line spacing apart, so size and baseline-shift footnote markers manually when the font lacks superiors.

### Tabular numbers

Most fonts draw a narrow 1 and a wide 4, so a live timer, price, or counter shoves its neighbors on every tick. Use `font-variant-numeric: tabular-nums` on anything that updates in place and on every number column in a table (right-aligned). Leave prose numbers proportional.

```css
.counter, .price, td.numeric { font-variant-numeric: tabular-nums; }
```

### Weight never changes on interaction

Any weight change, variable axis included, widens glyphs and reflows the line. Show hover and selected states with color.

```css
/* Wrong: layout shift */
.tab:hover, .tab.selected { font-weight: 600; }

/* Right */
.tab { font-weight: 500; }
.tab.selected { color: var(--color-primary); }
```

Define weights as variables so they can be tuned globally:

```css
:root {
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
}
```

## Type scale and rhythm

### Units

`rem` for font sizes (respects the reader's browser setting). `em` for things that ride with the text: tracking, underline offsets, icon sizes. `px` on text ignores user preferences; keep it for hairlines and borders.

### Build a scale, then obey it

Define a short, closed list of sizes. Departures need a justification; scattered one-off values rot as the codebase grows. Seed with a ratio (around 1.2 on a 16px root), round each step to a whole pixel, and keep only the steps the page uses.

```css
:root {
  --step--1: 0.75rem;  /* 12 */
  --step-0: 1rem;      /* 16 */
  --step-1: 1.125rem;  /* 18 */
  --step-2: 1.5rem;    /* 24 */
  --step-3: 2rem;      /* 32 */
}
```

Tailwind's `text-xs`…`text-9xl` is a legitimate ready-made scale with tuned line-heights. Solo, size names (`text-sm`) work with written conventions. On a team, name steps by role (`text-caption`, `text-card-title`) because a role name polices its own usage.

Neighbors must differ at a squint: a page title sits about 1.75× or more above its lede and adds weight. A lede supports its title; it shouldn't become a second headline.

### Leading per size

| Role | Size | `line-height` |
| --- | --- | --- |
| Body copy | 16px | `1.5`–`1.6` |
| Lede, subhead | 20–24px | `1.35`–`1.5` |
| Page title | 28–40px | `1.15`–`1.2` |
| Display | 48px+ | `1.05`–`1.1` |

Faces with long descenders want the upper end. Always write line-height unitless: `24px` breaks the moment size changes or the user zooms.

### Tracking per size

Kerning is the font's built-in pair adjustment and browsers apply it automatically. Never set `font-kerning: none`. CSS has no optical kerning; if one pair still gaps at hero size, tighten that pair alone with a `letter-spacing` span. Tracking (`letter-spacing`) is yours to set, in `em`:

| Text | Tracking |
| --- | --- |
| Sans heading 24px | about `-0.01em` |
| Sans heading 32px | about `-0.02em` |
| Sans heading 48px+ | about `-0.03em` |
| Serif headings | less than sans; judge the rendered words |
| Body at reading sizes | `0` |
| Small uppercase labels | `+0.04em` to `+0.08em`, at 11–12px |

Set uppercase labels smaller than nearby sentence-case text. Capitals fill the full cap height and tracking widens them, so a 13px uppercase label reads as large as 15px body and outshouts the content it labels. The exact values are font-dependent; pair size and tracking inside a `Text` component so callers never set them separately.

```css
.hero-title { font-size: var(--step-3); letter-spacing: -0.02em; }
.eyebrow {
  font-size: var(--step--1);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
```

### Space between text roles

Tight heading leading removes air, so return it as margin, graded by relationship: eyebrow to heading about 8px, heading to lede about 16px, intro to content 24px or more. Equal gaps fuse the header into one block.

### Cropping built-in space with `text-box`

Fonts reserve space above the cap height and below the baseline, which is why a label never sits dead-center in its button. `text-box` trims it. Ship as progressive enhancement; layouts must stay acceptable where it isn't supported.

```css
.tag { text-box: trim-both cap alphabetic; }   /* optically centered label */
.section-title { text-box: trim-start cap; }   /* flush to the block above */
```

## Line length and alignment

- **Cap the measure at 45–75 characters, about 65 ideal.** `max-width: 65ch` states it directly (`ch` is the width of `0`); Tailwind's `max-w-prose` is exactly `65ch`. Recheck when the family or size changes.
- **Left-align by default** (`text-align: start`); the ragged edge gives the eye a landmark. Never justify UI text: without hyphenation it opens rivers. Center only short display text that wraps two lines at most.
- `hyphens: auto` for narrow or justified columns; it needs a correct `lang`.

## Wrapping

| Role | Wrap mode |
| --- | --- |
| Headings | `text-wrap: balance` |
| Ledes, card descriptions, empty-state copy | `text-wrap: pretty` |
| Body paragraphs | `pretty` at most, never `balance` |

`balance` evens out line lengths so a two-line headline doesn't split 80/20. Browsers cap it at a few lines, and balancing a paragraph wastes the measure. `pretty` prevents a single orphaned word on the last line. `balance` isn't always right either: on a three-line headline it can leave line one awkwardly short, and a manual break wins.

**Overflow guards:**
- Anywhere a URL, hash, or user-supplied word could punch out of its box: `overflow-wrap: break-word`.
- Badges, buttons, key-value labels where a mid-label break reads as a bug: `white-space: nowrap`.
- `&nbsp;` welds a value to its unit (`42&nbsp;GB`); `&shy;` marks permitted breaks inside long words.

## Truncation and line clamp

```css
/* One line (Tailwind: truncate) */
.title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* N lines (Tailwind: line-clamp-3). Unprefixed line-clamp isn't dependable yet */
.grid-cell-text {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}
```

- **Truncation must leave a path to the full text:** a tooltip, a `title` attribute, an expandable row, or a detail view. A clipped ID with no way to read the rest is a data-loss bug.
- **Grid and table cells** truncate or clamp user content so one long value can't stretch the row. In flex children, add `min-width: 0` or truncation never kicks in.
- **Never type `...`.** Use the `…` character, or `text-overflow: ellipsis` when truncation should respond to width.

## Characters and casing

- **Casing is presentation.** Store strings in sentence case; apply `text-transform: uppercase`. Typed caps must be rewritten at every redesign and confuse screen readers and translation.
- **Real punctuation:** curly quotes `“ ”` `‘ ’` in prose (straight quotes stay in code), curly apostrophe `’`, en dash for ranges with no spaces (`Mon–Fri`, `1998–2004`), em dash for asides, single `…` for ellipsis.

| Instead of | Use |
| --- | --- |
| `...` | `…` |
| `'` | `’` |
| `"…"` | `“…”` |
| `1998-2004` | `1998–2004` |

## Underlines and links

- **Underline means link.** Never underline non-links for emphasis; it trains users to click text that goes nowhere. Use weight or color.
- **Set the underline by hand.** The default is a 1px hairline that collides with descenders.

```css
.prose a {
  text-decoration-color: color-mix(in oklab, currentColor 40%, transparent);
  text-decoration-thickness: 0.09em; /* about 1.5px at body size */
  text-underline-offset: 0.2em;
  text-decoration-skip-ink: auto;
  transition: text-decoration-color 150ms ease;
}
.prose a:hover { text-decoration-color: currentColor; }

abbr[title] { text-decoration: underline dotted; } /* dotted = "more here" */
```

- A thicker line needs the larger offset or it crowds the baseline. The muted color keeps it quiet; hover makes it solid.
- **Only the color of a native underline animates reliably.** An underline that grows, slides, or thickens must be its own element (pseudo-element, border, or background gradient).

## Selection, placeholders, carets

- `::selection` can carry a brand tint; the pair must stay legible in both themes.
- `user-select: none` on control labels and chrome (buttons, tabs, code-drawn illustrations) where selection reads as a glitch. Never on `body` on the web. Desktop app shells (Electron, Tauri) invert this: off globally, re-enabled on copyable content. Check that select-all grabs content, not interface.
- `::placeholder` lighter than entered text but still readable (APCA Lc 30 floor, see [color.md](color.md)).
- `caret-color` is the whole caret API. Don't rebuild the caret.
- `::target-text` styles text-fragment link targets; the CSS Custom Highlight API paints ranges (search hits) without wrapper elements.

## Form text and iOS zoom

Mobile Safari zooms the page into any focused input under 16px. Size input text at 16px and shrink only where the primary pointer is fine:

```tsx
// Tailwind v4.1+
<input className="text-base pointer-fine:text-sm" />
```

```css
input, select, textarea { font-size: 14px; }
@media (pointer: coarse) {
  input, select, textarea { font-size: 16px; }
}
```

- **Never gate on a width breakpoint** (`md:text-sm`): an iPad is wide and still zooms.
- **Never use `maximum-scale=1`** in the viewport meta. Safari ignores it for pinch zoom, while Android browsers obey it and lock zoom entirely, failing WCAG 1.4.4.

## Font smoothing

macOS renders type heavier than intended. Set smoothing once at the root and let it inherit:

```css
body {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

Tailwind's `antialiased` emits both. Don't re-declare per component.

## Size and contrast floors

- **Sizes:** body 16px. Dense UI (controls, menus) 14px, except inputs on touch devices. Captions and metadata 13px. Below 12px needs a real excuse; small uppercase labels at 11px are the one exception.
- **Contrast (WCAG AA):** regular text 4.5:1. Large text (24px+ regular, or 18.66px+ bold) 3:1. Check both themes; muted grey that passes on white often fails on near-black. APCA targets and repair method in [color.md](color.md).
- **Readers change text.** Assume zoom, larger root font size, and overridden line spacing. Nothing should break.

## Language and direction

- Declare `lang` on the document and on inline language switches; quotes, hyphenation, and speech synthesis key off it.
- `dir="rtl"` on right-to-left content.
- Use logical properties: `margin-inline-start` over `margin-left`, `padding-inline-end` over `padding-right`, `text-align: start` over `left`.

## Ornament

- `::first-letter` for drop caps (universal); `initial-letter` sizes it in lines but is missing in Firefox, so enhancement only.
- `background-clip: text` with transparent fill masks a gradient to glyphs. Avoid it on headlines in product and marketing UI; it costs contrast and reads as generated (see [design-foundations.md](design-foundations.md)).
- `-webkit-text-stroke` outlines glyphs in all modern engines. Seams inside stroked letters come from overlapping contours in variable fonts; use a static instance to remove them.

## Fast diagnoses

| Symptom | Fix |
| --- | --- |
| Layout twitches as a number ticks | `tabular-nums` |
| Bold looks smudged | Load the weight; `font-synthesis: none` |
| Text reflows when the webfont arrives | Fallback with `size-adjust` / `ascent-override`; preload |
| iPhone zooms on input focus | 16px input text unless `pointer: fine` |
| Headline splits seven words / one word | `text-wrap: balance` |
| Paragraph ends on one stranded word | `text-wrap: pretty` |
| Underline slices through g, y, p | `text-underline-offset: 0.2em`, `text-decoration-skip-ink: auto` |
| Long URL blows out a card | `overflow-wrap: break-word` |
| Weight change does nothing on some machines | `font-weight`, not `"wght"` |
| Paragraph feels like work to read | Cap near `65ch` |
| ALL-CAPS strings in JSX | Sentence case + `text-transform` |
| Ellipsis with no way to see the rest | Tooltip, `title`, or expand control |
| Layout mirrored wrong in Arabic/Hebrew | Logical properties |
| Text cramped in one component, airy in another | Route sizes and leading through the scale |

## CSS to Tailwind lookup

| CSS | Tailwind (v4) |
| --- | --- |
| `-webkit-font-smoothing` + `-moz-osx-font-smoothing` | `antialiased` |
| `font-synthesis: none` | `[font-synthesis:none]` |
| `font-optical-sizing: auto` | `[font-optical-sizing:auto]` |
| `font-variation-settings: "SOFT" 80` | `[font-variation-settings:"SOFT"_80]` |
| `font-feature-settings: "ss02" 1` | `[font-feature-settings:"ss02"]` |
| `font-variant-numeric: tabular-nums` | `tabular-nums` |
| `font-variant-numeric: slashed-zero` | `slashed-zero` |
| `font-variant-caps: small-caps` | `[font-variant-caps:small-caps]` |
| `font-variant-position: super` | `[font-variant-position:super]` |
| `line-height` | `leading-*` |
| `letter-spacing` | `tracking-*` |
| `max-width: 65ch` | `max-w-prose` / `max-w-[65ch]` |
| `text-box: trim-both cap alphabetic` | `[text-box:trim-both_cap_alphabetic]` |
| `text-wrap: balance` / `pretty` | `text-balance` / `text-pretty` |
| `white-space: nowrap` | `whitespace-nowrap` |
| `overflow-wrap: break-word` | `break-words` |
| `hyphens: auto` | `hyphens-auto` |
| one-line ellipsis trio | `truncate` |
| `-webkit-line-clamp: 3` + box | `line-clamp-3` |
| `text-transform: uppercase` | `uppercase` |
| `text-decoration-thickness: 0.09em` | `decoration-[0.09em]` |
| `text-decoration-color` | `decoration-*` |
| `text-underline-offset: 0.2em` | `underline-offset-[0.2em]` |
| `text-decoration-style: dotted` | `decoration-dotted` |
| `text-decoration-skip-ink: auto` | `[text-decoration-skip-ink:auto]` |
| `caret-color` | `caret-*` |
| `user-select: none` | `select-none` |
| `text-align: start` | `text-start` |
| 16px unless fine pointer | `text-base pointer-fine:text-sm` |

## Checklist

- [ ] Fonts are `woff2`, subset, only used weights loaded, above-the-fold faces preloaded with `crossorigin`
- [ ] Fallback stack metric-matched; `font-synthesis: none` set
- [ ] Weights and features through `font-weight` / `font-variant-*`; raw tags only for custom axes and numbered sets
- [ ] Every size from the scale; line-height unitless and graded by size
- [ ] Tracking negative on large headings, positive on small uppercase, zero on body
- [ ] Reading columns capped near `65ch`
- [ ] `balance` on headings, `pretty` on short descriptive text, never `balance` on paragraphs
- [ ] `tabular-nums` on live numbers and table columns; no weight change on hover or selection
- [ ] Every truncation offers the full text; long tokens can break
- [ ] Sentence-case source strings; real quotes, dashes, and `…`
- [ ] Links underlined at ~`0.09em`, offset `0.2em`, skip-ink; non-links never underlined
- [ ] Inputs 16px on coarse pointers; no `maximum-scale=1`
- [ ] Smoothing set once at the root; sizes and contrast at or above the floors in both themes
