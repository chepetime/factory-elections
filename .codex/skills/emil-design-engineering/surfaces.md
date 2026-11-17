# Surfaces

How surfaces meet and separate: shadows vs borders, elevation tokens, nested border radii, hairline borders, image outlines, gradients and fades, dark-mode surface treatment, theme variables, and switching themes without flashes or ragged transitions. Read it when styling cards, buttons, menus, dialogs, or images, when something "looks flat" or a border "looks harsh", or when building or fixing a dark theme. Color values and dark-mode palettes are in [color.md](color.md).

Put shadow and color tokens wherever the project keeps design tokens (Tailwind `@theme`, `:root` variables, a theme object) and write fixes in the project's styling idiom.

## Principles

1. **Derive nested radii.** Inner radius = outer radius − padding.
2. **Shadows for depth, borders for separation.** Raised elements get a stacked translucent shadow; dividers and inputs keep real borders.
3. **One depth cue per surface.** Never border, shadow, ring, and gradient on the same card.
4. **Dark mode collapses shadows to a white ring.**
5. **Hairlines on high-density screens.** 0.5px on retina, 1px elsewhere.
6. **Ease gradients; fade with masks.** Never fade over scrollable content.
7. **Image outlines are pure black or pure white at 10%.**
8. **Themes flip variables.** Never per-component `dark:` color overrides.

## Nested border radius

A rounded child inside a rounded parent gets its radius by subtraction. Copying the parent's radius pinches the corner gap, the most frequent giveaway of unpolished UI.

```css
/* Right: even gap around the corner */
.dialog      { border-radius: 16px; padding: 6px; }
.dialog-body { border-radius: 10px; } /* 16 − 6 */

/* Wrong: child repeats the parent's radius */
.dialog, .dialog-body { border-radius: 16px; }
```

```tsx
<section className="rounded-3xl p-3">  {/* 24px outer, 12px padding */}
  <article className="rounded-xl">     {/* 24 − 12 = 12px */}
```

- If padding ≥ outer radius, the inner radius is 0 (or a small floor like 2–4px if the design needs softness).
- Once the gap between layers passes about 24px, the surfaces read as independent; pick each radius on its own.
- Radii come from a scale. `rounded-2xl` on everything is a default, not a decision.

## Shadows vs borders

**Use a shadow** when the element reads as raised: cards, bordered buttons, menus, popovers, dialogs, anything that crosses mixed or image backgrounds, hover and focus lift.

**Keep a border** when the line separates: list-row dividers, table gridlines, form-field edges (a visible input outline is an accessibility feature), hairline rules in dense layouts.

**Why shadows for depth:** a solid border color is tuned to exactly one background. Translucent shadow layers composite with whatever is underneath, so one token works everywhere, and the edge reads as depth instead of a stamped outline.

**Wrong:** `border: 1px solid #e0e0e0` on a card. **Right:** a translucent edge, `rgb(0 0 0 / 0.08)` or less, as a ring shadow or alpha border. The solid one looks pasted on; the alpha one recedes.

**Wrong:** one large drop shadow. **Right:** three stacked layers. A single big blur reads as fake; layers read as physical.

### Elevation tokens

Three ingredients: a 1px spread standing in for the border, a tight crisp layer just beneath, and a wider soft layer for ambient depth.

```css
:root {
  --elevation-raised:
    0 0 0 1px rgb(0 0 0 / 0.05),
    0 1px 3px rgb(0 0 0 / 0.05),
    0 4px 10px -4px rgb(0 0 0 / 0.05);
  --elevation-raised-hover:
    0 0 0 1px rgb(0 0 0 / 0.07),
    0 1px 3px rgb(0 0 0 / 0.07),
    0 4px 10px -4px rgb(0 0 0 / 0.08);
}

/* Hook into however the project switches themes */
[data-theme="dark"] {
  --elevation-raised: 0 0 0 1px rgb(255 255 255 / 0.09);
  --elevation-raised-hover: 0 0 0 1px rgb(255 255 255 / 0.14);
}
```

- Define a small set of levels (raised, overlay for menus and popovers, modal) and use only those. Higher levels grow blur and offset; they don't grow opacity much.
- All shadows in a product share one light direction (light from above: positive y-offset). Mixed directions feel subtly wrong.

### Hover

Transition only the shadow:

```css
.panel {
  box-shadow: var(--elevation-raised);
  transition: box-shadow 150ms ease-out;
}
.panel:hover { box-shadow: var(--elevation-raised-hover); }
```

`transition: all` here also animates anything else that changes and makes the hover feel heavy.

### Ring shadow as a border

The lone spread ring works anywhere a real 1px border sits awkwardly against its background, and it costs no layout space:

```css
/* Instead of border: 1px solid rgba(0, 0, 0, 0.08) */
box-shadow: 0 0 0 1px rgb(0 0 0 / 0.08);
```

```tsx
<div className="ring-1 ring-black/5 dark:ring-white/10" />
```

## Hairline borders

For borders you keep, render 0.5px on high-density screens:

```css
:root {
  --border-hairline: 1px;

  @media (min-resolution: 2dppx) {
    --border-hairline: 0.5px;
  }
}

.divider { border-bottom: var(--border-hairline) solid var(--gray-6); }
```

Sharp on retina, falls back to 1px on standard displays. Use it for dividers and fine details.

## Image outlines

Every photo and screenshot gets a 1px translucent line drawn just inside its bounds, so image edges match every other surface.

```css
img {
  outline: 1px solid rgb(0 0 0 / 0.1);
  outline-offset: -1px; /* inside the image, no layout cost */
}

[data-theme="dark"] img { outline-color: rgb(255 255 255 / 0.1); }
```

```tsx
<img
  src={src}
  alt={alt}
  className="outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
/>
```

- **Pure black at 10% in light, pure white at 10% in dark.** Never a tinted neutral (slate, zinc, `#111827`) and never the accent. Tinted lines pick up the surface behind the image and look like grime along the edge.
- Use `outline`, not `border`, so the box size doesn't change.

## Gradients and fades

### Eased gradients

A linear gradient between two solid colors shows visible banding and a hard-looking midpoint. Use an eased gradient: multiple stops following an easing curve. Generate them with https://larsenwork.com/easing-gradients/.

```css
/* Wrong: linear, bands and looks abrupt */
background: linear-gradient(to bottom, oklch(0.2 0 0), transparent);

/* Right: eased stops */
background: linear-gradient(
  to bottom,
  oklch(0.2 0 0) 0%,
  oklch(0.2 0 0 / 0.738) 19%,
  oklch(0.2 0 0 / 0.541) 34%,
  oklch(0.2 0 0 / 0.382) 47%,
  oklch(0.2 0 0 / 0.278) 56.5%,
  oklch(0.2 0 0 / 0.194) 65%,
  oklch(0.2 0 0 / 0.126) 73%,
  oklch(0.2 0 0 / 0.075) 80.2%,
  oklch(0.2 0 0 / 0.042) 86.1%,
  oklch(0.2 0 0 / 0.021) 91%,
  oklch(0.2 0 0 / 0.008) 95.2%,
  oklch(0.2 0 0 / 0.002) 98.2%,
  transparent 100%
);
```

- For two-hue gradients, interpolate in a perceptual space so the middle doesn't go muddy: `linear-gradient(in oklch, …)` or `in oklab`.
- One gradient per screen at most, with a job, built from the chosen palette. Several decorative gradients read as generated (see [design-foundations.md](design-foundations.md)).

### Masks over gradient overlays

To fade content out, use `mask-image`. A gradient overlay only matches one background color; a mask composites with whatever is behind it.

```css
.fade-bottom {
  mask-image: linear-gradient(to bottom, black 80%, transparent);
}
```

### No fades on scrollable content

A fade over a scrollable list restricts the visible area and hides the content the user is scrolling toward. Remove it. If an overflow hint is needed, show it only when there is more content to scroll to, and remove it at the end.

## Dark-mode surfaces

- **Shadows collapse to a ring.** Stacked black shadows are invisible on dark surfaces, so cards, menus, and popovers that rely on them dissolve. In the dark theme each elevation token becomes one white ring at about 8–10% (see the tokens above).
- **Raised surfaces use a white-alpha ring; flat separators may use a solid token.** A `rgb(255 255 255 / 0.1)` ring on a popover defines its edge against any background. A divider inside a surface can use a solid border token from the scale, which sits more quietly than a glowing alpha line.
- **Brightness encodes elevation.** Page darkest, cards a step lighter, menus and modals lighter still. The topmost surface is the brightest. Inverting the light theme's order makes overlays sink.
- **Image outlines switch to white at 10%.**
- **Check every edge.** Open each dropdown, popover, tooltip, and modal in the dark theme and confirm its edge is visible.

## Theme variables

Use a numbered scale of CSS variables and swap values per theme. Values in OKLCH (see [color.md](color.md)).

```css
:root {
  --gray-1:  oklch(0.985 0 0);
  --gray-2:  oklch(0.97 0 0);
  /* … */
  --gray-12: oklch(0.205 0 0);
}

[data-theme="dark"] {
  --gray-1:  oklch(0.205 0 0);
  --gray-2:  oklch(0.24 0 0);
  /* … */
  --gray-12: oklch(0.985 0 0);
}
```

Alias the scale with semantic tokens so components never care which theme is active. Declare aliases on the theme selector too, so they resolve against that theme's scale:

```css
:root,
[data-theme] {
  --color-button-bg: var(--gray-12);
  --color-button-text: var(--gray-1);
}

.button {
  background: var(--color-button-bg);
  color: var(--color-button-text);
}
```

**Wrong:** `bg-gray-900 dark:bg-gray-100` on every component. **Right:** utilities pointed at variables that flip once at the root. Scattered `dark:` overrides drift out of sync and get missed on new components.

### Hardcoded colors that don't flip

The most common dark-mode defects: one `bg-white` on a dropdown, one `#fff` in an SVG, one `border-gray-200` on a card, each a bright rectangle in the dark theme. Point each at an existing token. Icons use `currentColor`:

```html
<svg fill="none" stroke="currentColor">…</svg>
```

Don't patch these with new per-component `dark:` classes.

### Images and embeds

- Transparent PNGs or SVGs with dark text, diagrams drawn for white, light-UI screenshots on dark pages all break on the other background. Serve a second asset:

```html
<picture>
  <source srcset="/diagram-dark.svg" media="(prefers-color-scheme: dark)" />
  <img src="/diagram-light.svg" alt="…" width="800" height="400" />
</picture>
```

  That works when the theme follows the OS. With a class-based toggle, render both and hide one by theme class.
- Third-party surfaces follow the theme: syntax highlighters take a theme per scheme (Shiki `themes: { light, dark }`), Stripe Elements, Clerk, and most widgets take an appearance option. Pass the resolved theme through.

### Half a dark mode is worse than none

If some components have dark styles and others don't, and the OS setting or a toggle can activate it, users get dark cards on white pages. Either finish the theme or make it unreachable (remove the toggle, set `color-scheme: light`, stop the dark variant from firing).

## Theme switching

### Declare the schemes you designed

```css
:root { color-scheme: light; }        /* light-only app */
:root { color-scheme: dark; }         /* dark-only: native controls and scrollbars go dark */
:root { color-scheme: light dark; }   /* both themes designed */
```

`color-scheme` sets native scrollbars, form controls, and autofill. A dark-only app without it gets white scrollbars and a white flash; a light-only app that declares `light dark` gets dark native controls under a light UI. With a toggle, set `color-scheme` per theme alongside `data-theme`. Also set `theme-color` per scheme for browser chrome.

Autofill paints its own background regardless of theme; override it for dark forms:

```css
input:-webkit-autofill {
  -webkit-text-fill-color: var(--gray-12);
  box-shadow: 0 0 0 100px var(--gray-2) inset;
}
```

### Correct on first paint

A theme read from `localStorage` in `useEffect` paints the wrong theme first, then flashes. Set the class or `data-theme` with a blocking inline script in `<head>` before paint. `next-themes` does this; a hand-rolled toggle usually doesn't.

```html
<script>
  try {
    const t = localStorage.getItem("theme") ??
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = t;
    document.documentElement.style.colorScheme = t;
  } catch {}
</script>
```

### No transitions during the switch

Every component has its own transition duration, so a theme toggle animates each surface at a different speed and the page ripples. Disable transitions for the swap.

```jsx
<ThemeProvider disableTransitionOnChange>{children}</ThemeProvider>
```

Without `next-themes`:

```js
function setTheme(theme) {
  const root = document.documentElement;
  root.classList.add("no-transitions");
  root.dataset.theme = theme;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.remove("no-transitions"));
  });
}
```

```css
.no-transitions,
.no-transitions * { transition: none !important; }
```

Two frames ensures the new styles have painted before transitions come back.

## Symptoms and fixes

| Symptom | Fix |
| --- | --- |
| Corners pinch where a rounded child meets its parent | Inner radius = outer − padding |
| Card looks stamped onto the page | Replace the solid border with the elevation token |
| Cards disappear in dark mode | Collapse the shadow token to a white ring |
| Shadow hover feels laggy or heavy | Transition `box-shadow` only |
| Stripes across a large gradient | Eased stops; interpolate `in oklch` |
| A fade only looks right on one background | Rebuild with `mask-image` |
| Fade over a scrolling list | Remove it |
| Image edges look dirty | Pure black/white outline at 10%, inset |
| `dark:` overrides everywhere | Flip a variable scale at the theme root |
| White rectangle in dark mode | Hardcoded `bg-white` / `#fff`; point at a token |
| Wrong theme flashes on refresh | Blocking `<head>` script before paint |
| Page ripples on theme toggle | Disable transitions during the switch |

## Checklist

- [ ] Inner radii derived (outer − padding) wherever rounded surfaces nest
- [ ] Raised elements use elevation tokens; separation borders kept and hairline on retina
- [ ] One depth cue per surface; shadows share one light direction
- [ ] Shadow hover transitions `box-shadow` only
- [ ] Dark theme collapses every shadow to a white ring; topmost surface brightest
- [ ] Images carry the inset 1px outline, black/10 light and white/10 dark, never tinted
- [ ] Large gradients eased; fades use `mask-image`; nothing fades over a scroll area
- [ ] Themes flip variables at the root; no hardcoded colors or per-component `dark:` overrides
- [ ] `color-scheme` declares exactly the designed schemes
- [ ] Theme set before first paint; transitions disabled during the switch
- [ ] Every route, menu, and modal opened in the other theme
