# Color

How to define, derive, and check color in CSS using OKLCH: reading values, building tonal scales and multi-hue families, semantic tokens, contrast (WCAG and APCA), converting legacy colors, P3 gamut, Tailwind v4 theming, and dark-mode palettes. Read it when picking, converting, or auditing colors, building a palette, repairing contrast, or deriving a dark theme. Surface treatment in dark mode (shadows, rings, image outlines, theme switching) is in [surfaces.md](surfaces.md).

Write changes in the project's existing color mechanism (CSS custom properties, Tailwind `@theme`, a CSS-in-JS theme object, generated tokens). A color fix is never a reason to add a parallel theming layer.

## Reading OKLCH

```css
color: oklch(0.586 0.222 17.585);          /* saturated crimson */
color: oklch(0.398 0.066 227.392 / 0.9);   /* deep slate-cyan at 90% opacity */
```

- **L** 0 (black) to 1 (white), perceptually even: 0.5 looks mid-toned in every hue.
- **C** chroma, 0 is grey, tops out around 0.4 in extreme cases. The reachable maximum depends on L and H.
- **H** hue angle. Landmarks: ~20 red, ~90 yellow, ~145 green, ~195 cyan, ~260 blue, ~330 pink.
- Alpha goes after a slash. `oklch(0.5, 0.1, 200, 0.5)` with commas is invalid.
- Three decimals per channel is enough. Drop trailing zeros; write `0`, not `-0`. Support is Baseline since 2023.

**Why OKLCH over HSL.** HSL lies twice. Its lightness is decorative: `hsl(55 100% 50%)` (yellow) and `hsl(255 100% 50%)` (blue-violet) claim the same lightness and look nothing alike. Its hue drifts with lightness: an HSL blue ramp at H 240 lands at OKLCH hue ≈ 273 at 25% L and ≈ 285 at 88% L, so light steps slide visibly toward violet. OKLCH pins both.

## Operating rules

- **Everything new is OKLCH.** No new hex or `hsl()` literals.
- **L answers light or dark.** Surface L above 0.6 reads light and takes dark text; at or below 0.6 takes light text.
- **Contrast lives in the L gap.** Hue and chroma barely move contrast. Repair a failing pair by moving L.
- **One hue per ramp.** Every step keeps the same H.
- **Vividness is relative.** Each hue has its own chroma ceiling at a given L. For sibling colors, hold L constant and give each hue the same fraction of its own ceiling.
- **Check gamut before shipping high chroma.** Clamp C to fit sRGB; serve P3 chroma behind a media query.
- **Neutrals agree with the brand.** Blue UIs take cool greys; warm greys fight blue. Never pure `#808080`: tint neutrals with a slight hue bias (C around 0.005–0.015 on the brand hue) and they read as designed.

## Building a tonal scale

Steps run 50 (near-white) to 950 (near-black): 50, 100, 200 … 900, 950. Leaner systems drop stops (nine steps omit 400 and 600; five keep 100/300/500/700/900).

1. **Anchor L endpoints, space evenly.** Step 50 around L 0.97, step 950 around L 0.22, linear between. Don't run to L 0 or 1; chroma collapses at the poles and the endpoints stop reading as the hue.
2. **Shape chroma as a curve.** Express each step's C as a fraction of that step's sRGB ceiling: about 30% at the extremes rising to about 85% around 400–500. Tints stay airy, shades stay rich.
3. **Clamp per step.** The ceiling `maxC(L, H)` differs at every L. A saturated base necessarily loses absolute chroma toward both ends; that's gamut geometry, not an error.
4. **Hue stays fixed** across all steps.

```css
:root {
  --berry-50:  oklch(0.97 0.007 330);
  --berry-100: oklch(0.895 0.042 330);
  --berry-200: oklch(0.82 0.103 330);
  --berry-300: oklch(0.745 0.189 330);
  --berry-400: oklch(0.67 0.251 330);
  --berry-500: oklch(0.595 0.231 330);
  --berry-600: oklch(0.52 0.195 330);
  --berry-700: oklch(0.445 0.151 330);
  --berry-800: oklch(0.37 0.105 330);
  --berry-900: oklch(0.295 0.063 330);
  --berry-950: oklch(0.22 0.03 330);
}
```

Chroma peaks near 400 because the sRGB gamut at H 330 is widest around L 0.67.

**Light tints: lower chroma, not opacity.** A tint built with opacity goes grey and shifts with whatever sits behind it. Use a solid step from the ramp.

### Multi-hue families

To make brand, success, and warning feel like one system, match **the same L per step number** and **the same fraction of each hue's ceiling**, never the same absolute C:

```css
:root {
  /* all at L 0.65, each at 70% of its own sRGB ceiling */
  --teal-500:   oklch(0.65 0.08 185);   /* ceiling ≈ 0.115 */
  --amber-500:  oklch(0.65 0.096 75);   /* ceiling ≈ 0.137 */
  --violet-500: oklch(0.65 0.155 300);  /* ceiling ≈ 0.221 */
}
```

Copying one C across hues ("all our 500s use 0.19") over-saturates roomy hues and flattens cramped ones.

**Don't reuse the brand hue for a status.** If green is the primary brand color, success needs a distinct hue, or users can't tell "primary action" from "it worked".

### Auditing an inherited scale

Convert every step to OKLCH and read the H values. A spread over ~10° between min and max is visible drift. Keep the mid-tone hue and regenerate the ramp with the steps above.

## Semantic tokens

- **Components reference roles, not raw values.** `--color-border-subtle`, `--color-text-muted`, `--color-button-bg`. Raw hex scattered through components breaks the moment anything changes and can't flip per theme.
- **Two layers.** A numbered scale (`--gray-1`…`--gray-12`, `--berry-50`…`--berry-950`) holds values. Semantic tokens alias the scale. Themes swap scale values or re-point aliases; components never change.
- **Derive interaction states.** `color-mix(in oklch, var(--color-primary) 85%, black)` for hover, never a hand-picked darker hex that drifts hue.
- **Disabled is a token.** A dedicated muted color, never `opacity: 0.4`, which passes contrast on some backgrounds and fails on others.
- **Icons use `currentColor`** so they follow the text token.

```css
:root {
  --color-primary: oklch(0.52 0.195 330);
  --color-primary-hover: color-mix(in oklch, var(--color-primary) 85%, black);
  --color-text-disabled: var(--gray-8);
}
```

## Contrast

### Find the real pair first

A contrast number only means something for a specific foreground against the surface it actually paints over (usually the nearest opaque ancestor background). Measuring against the wrong surface gives confidently wrong answers.

### Repair by moving L

```css
/* fails: lavender text nearly as light as its card */
.card       { background: oklch(0.93 0.03 300); }
.card-label { color: oklch(0.72 0.14 300); }

/* passes: only L moved; hue and vividness survive */
.card-label { color: oklch(0.42 0.14 300); }
```

Keep H. Keep C unless the new L can't hold it in gamut, then clamp C to the ceiling. Raising chroma to "make it pop" does nothing: vividness is not contrast.

### APCA (prefer for design decisions)

APCA models perceived lightness difference, which WCAG 2's ratio misjudges in both directions. It reports a signed Lc: dark-on-light positive (black on white ≈ 106), light-on-dark negative (white on black ≈ −108). Compare magnitudes.

| Use | Minimum \|Lc\| |
| --- | --- |
| Body text, 14–16px regular UI text | 75 (90 preferred) |
| Other content text at 24px regular / 16px bold and up | 60 |
| Headlines (about 36px regular / 24px bold) | 45 |
| Placeholder, disabled text, icons, focus rings, borders | 30 |

These are floors, not goals.

### WCAG 2 (when compliance is named)

| Use | AA | AAA |
| --- | --- | --- |
| Body text | 4.5:1 | 7:1 |
| Large text: 24px+ regular, 18.66px+ bold | 3:1 | 4.5:1 |
| UI components, meaningful graphics, input borders, focus rings | 3:1 | — |

When a contract or audit names WCAG 2.x, satisfy it regardless of APCA. For compliance work, satisfy both; the union is rarely much stricter than APCA alone. A 3:1 pair on small text is a fail under both systems, not a judgment call.

### The brand-label exception

Brand-colored short labels on dark (links, tabs, chip text) are held to WCAG AA with margin, about **6:1**, instead of APCA Lc 60. Lc 60 forces them to about L 0.77, where blues and violets have so little chroma left that the brand goes pastel. WCAG flatters light-on-dark, so 6:1 is the floor for these, never 4.5:1. Paragraphs and neutral text keep the APCA floors.

### Triage heuristics

- Near-white surface (L ≥ 0.95): body text wants L ≤ 0.45.
- Near-black surface (L ≤ 0.25): neutral body text wants L ≥ 0.85; brand labels clear about 6:1 around L 0.66–0.72.
- Mid-tone surfaces (L 0.3–0.6) leave little room for any foreground; compute real numbers.

Heuristics get you in range in one guess. Run the real APCA or WCAG check before shipping, in every theme.

## Converting legacy colors

Conversion is value-for-value substitution. Selector, declaration, and surrounding function stay as written.

```css
/* before */
.alert-title { color: #e11d48; }
.badge       { background: rgb(22, 163, 74); }
.divider     { border-top: 1px solid rgba(255, 255, 255, 0.12); }
.link        { color: hsl(268, 60%, 45%); }

/* after */
.alert-title { color: oklch(0.586 0.222 17.585); }
.badge       { background: oklch(0.627 0.17 149.214); }
.divider     { border-top: 1px solid oklch(1 0 0 / 0.12); }
.link        { color: oklch(0.468 0.202 299.662); }
```

**Never convert:** keywords (`currentColor`, `transparent`, `inherit`, `initial`, `unset`), gradient interpolation hints and positions (convert only the stops), and third-party config that parses hex (chart libraries, manifests).

**Whole-file pass:** hex first, then `rgb()`/`rgba()`, then `hsl()`/`hsla()`. Keep comments, indentation, and order so the diff shows only color values. Fully opaque values get three channels, no `/ 1`. Re-check contrast-critical pairs afterward.

## Gamut and Display P3

OKLCH describes more colors than screens show. sRGB is the universal floor. Display P3 (modern phones, Macs) is roughly a quarter larger, with extra room in greens, reds, and pinks.

Chroma ceilings swing with hue and lightness. In sRGB at L 0.5: violet near H 285 reaches C ≈ 0.29, red near H 25 ≈ 0.20, cyan near H 195 under ≈ 0.09. By L 0.7 the peak moves to pinks (H 330, C ≈ 0.31); by L 0.9 to spring greens. Cyan is cramped everywhere; plan for muted teals.

**Clamp yourself.** Out-of-gamut values get mapped by the browser with results you didn't choose. Keep L and H, pull C to the boundary:

```css
color: oklch(0.6 0.31 20);   /* more red than sRGB has here */
color: oklch(0.6 0.241 20);  /* largest faithful C */
```

**Layer P3 as enhancement:**

```css
.cta { background: oklch(0.66 0.2 330); }

@media (color-gamut: p3) {
  .cta { background: oklch(0.66 0.32 330); }
}
```

For pre-2023 browser support, put a hex floor underneath and wrap the OKLCH rules in `@supports (color: oklch(1 0 0))`.

## Tailwind v4

Tailwind v4's palette is authored in OKLCH and custom `@theme` colors should be too. No hex tokens in `@theme`.

```css
@theme {
  --color-berry-50:  oklch(0.97 0.007 330);
  --color-berry-500: oklch(0.595 0.231 330);
  --color-berry-950: oklch(0.22 0.03 330);
  /* … every step */
}
```

`--color-<name>-<step>` generates `bg-berry-500`, `text-berry-100`, `border-berry-700`, and the rest. Opacity suffixes compose: `text-berry-600/75` emits `oklch(0.52 0.195 330 / 0.75)`.

**Porting a hex theme:** convert every `@theme` token; chase `theme()` calls and hardcoded hex that duplicated tokens; re-run contrast checks and look at dark mode (colors picked by eye in hex often measure slightly off); add a `color-gamut: p3` layer for extra punch rather than raising the base token.

## Dark-mode palettes

Never hand-pick a second palette by eye. Keep each hue and derive values from the role and the surface.

**Neutrals mirror.** Surface, ink, borders, and muted text swap with their mirror steps: 50 ↔ 950, 200 ↔ 800, 300 ↔ 700. Even L spacing means a pair reads about as distinct after the flip. Still check each text pair.

```css
:root               { --surface: var(--gray-50);  --ink: var(--gray-950); }
[data-theme="dark"] { --surface: var(--gray-950); --ink: var(--gray-50); }
```

**Keep the layering hierarchy.** Dark mode is not inverted light mode. Raised surfaces get lighter as they come forward: page darkest, cards a step lighter, popovers and modals lighter still. The topmost surface is the brightest.

**Accents don't mirror.** Mapping brand text 600 → 300 and its tint 50 → 950 fails twice: the light end of the ramp is low-chroma by design, so brand text turns pastel; the dark end sits barely above the surface, so a tint reads as a stain. Re-pick each role on the same H:

| Role | Dark-mode value |
| --- | --- |
| Brand text (links, active tabs, chip labels) | Lowest L that clears about 6:1, at the brand's own C, capped at ~95% of the ceiling at that L |
| Tint behind brand text (badge, selected row) | About 0.07 L above the surface, C around 0.09 or what the ceiling allows (cyan/teal top out near 0.05) |
| Fills (meters, progress, dots) | L about 0.6, brand C capped by the ceiling; non-text only needs 3:1 |
| Solid button with white label | Brand with L nudged up (usually ≤ 0.05) until white clears 4.5:1 and the button separates from the surface |

Every step of L above what contrast needs costs chroma at low-ceiling hues (blue and violet lose about 0.03 C per 0.05 L) and buys nothing. Cap at the brand's C on roomy hues: magenta's ceiling at L 0.72 is about 0.29, and filling it goes neon.

**Desaturating the brand is the wrong fix.** Keep hue and chroma and re-pick L per role. A desaturated brand becomes a duller, different color.

**No low-opacity brand tints on dark.** 15% of a vivid indigo over a dark surface lands near C 0.05, a grey-violet, and shifts with the background. Use a solid low-L value on the hue.

Worked example, berry 600 brand on a dark surface at L 0.215:

```css
:root {
  --brand-text: var(--berry-600);        /* 6.1:1 on white */
  --brand-tint: var(--berry-50);
  --brand-tint-text: var(--berry-700);
  --brand-fill: var(--berry-600);
  --brand-button: var(--berry-600);
}

[data-theme="dark"] {
  --brand-text: oklch(0.72 0.195 330);      /* 6.4:1 on the surface */
  --brand-tint: oklch(0.29 0.09 330);
  --brand-tint-text: oklch(0.76 0.195 330); /* 6.3:1 on the tint */
  --brand-fill: oklch(0.62 0.195 330);
  --brand-button: oklch(0.57 0.195 330);    /* white 5.0:1; 3.5:1 vs surface */
}
```

The mirrored tint (berry-950) has the same L as the surface, so the badge would vanish. A mirrored indigo 300 lands near `oklch(0.78 0.09 277)`: 8.6:1 when 6:1 would do, and too pale to read as the brand.

## Reporting changes

Group by file. Quote each declaration's old value beside its replacement with a short clause naming the rule (drifting hue, insufficient L gap, out-of-gamut chroma, opacity tint). Cover every declaration touched.

## Checklist

- [ ] New colors are OKLCH; alpha after `/`; no hex in Tailwind `@theme`
- [ ] Each ramp holds one H; inherited scales checked for >10° drift
- [ ] Ramp L evenly spaced 0.97 → 0.22; C a per-step fraction of the ceiling
- [ ] Sibling hues share L per step and the same fraction of their own ceilings
- [ ] Components use semantic tokens; hover via `color-mix(in oklch, …)`; disabled is a token
- [ ] Neutrals tinted toward the brand hue; status colors distinct from the brand
- [ ] Contrast checked on the real pair, in both themes; repairs move L only
- [ ] Body text meets APCA Lc 75 or WCAG 4.5:1; brand labels on dark about 6:1
- [ ] High chroma clamped to sRGB; extra punch behind `@media (color-gamut: p3)`
- [ ] Dark neutrals mirrored; accents re-picked per role; no opacity tints; topmost surface brightest
