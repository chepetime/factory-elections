# Touch & Accessibility

Making interfaces work for a thumb, a keyboard, and a screen reader: tap targets, hover versus touch, `touch-action`, iOS Safari quirks, keyboard navigation, focus management, ARIA, and video. Read this when building or reviewing any interactive UI or fixing mobile behavior. These rules are the baseline, not enhancements to add later. Reduced motion is covered briefly here; depth is in [animation-performance-accessibility.md](animation-performance-accessibility.md). Viewport units, safe areas, and the software keyboard are in [mobile.md](mobile.md).

## Hover versus touch

### Gate hover behind capability queries

Touch devices fire `:hover` on tap and leave it stuck until the next tap elsewhere. Apply hover styles only where hovering exists:

```css
@media (hover: hover) and (pointer: fine) {
  .card:hover { transform: translateY(-2px); }
}
```

Tailwind v4 gates `hover:` this way by default. JavaScript hover handlers check `e.pointerType === "mouse"` and ignore mouse events for 50ms after a touch, since iOS fires an emulated mouse `pointerenter` after a tap ([interaction-details.md](interaction-details.md)).

### Hover enhances, never enables

A control that only appears on hover is unreachable on touch and by keyboard. Hide it only inside the hover query, so on a coarse pointer it is always rendered (a lower-emphasis style is fine), and reveal it on `:focus-within` too:

```css
@media (hover: hover) and (pointer: fine) {
  .row .actions { opacity: 0; }
  .row:hover .actions,
  .row:focus-within .actions { opacity: 1; }
}
```

`:focus-within` does nothing for a finger and the hover query does nothing for a keyboard; you need both. Feedback (errors, confirmations, status) is always visible on the page, never only in a hover tooltip or inside a modal.

## Tap targets

### At least 44px

The visual can stay small; the hit area can't. A 28px icon button mis-taps. Expand with a pseudo-element:

```css
.icon-button {
  position: relative;
  width: 24px;
  height: 24px;
}
.icon-button::before {
  content: "";
  position: absolute;
  inset: -10px; /* 24 + 2 × 10 = 44px */
}
```

Tailwind: `relative before:absolute before:-inset-2.5`. Or size it directly:

```css
.small-button {
  min-width: 44px;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

- **Hit areas never overlap.** If an expanded area collides with a neighbor, shrink it to the largest size that doesn't.
- **Usual offenders:** toast dismiss buttons, table row actions, pagination, close buttons in sheets, icon buttons sized `size-6` or `h-8 w-8`.
- **Label rows count.** A checkbox whose label toggles it has a target the size of the row ([forms.md](forms.md)).

## Taps feel instant

### `touch-action`

`touch-action: manipulation` tells the browser this element never double-tap-zooms, so `click` fires without waiting for a second tap:

```css
button, a, input, [role="button"] { touch-action: manipulation; }
```

Custom gesture surfaces hand the browser every axis they don't use. The value names what the browser may still do:

```css
.carousel     { touch-action: pan-y; } /* I own horizontal; the page still scrolls vertically */
.sheet-handle { touch-action: pan-x; } /* I own vertical */
.canvas       { touch-action: none; }  /* I own every axis: a canvas, map, or free 2D drag */
```

`touch-action: none` on something people need to scroll past traps them. Only a surface that owns both axes gets `none`. Gesture handling itself is in [animation-gestures-scroll.md](animation-gestures-scroll.md).

### Tap highlight and press feedback

iOS and Android paint a translucent flash on anything with a click handler. Remove it globally, then give every control its own `:active` state, because you removed the only feedback the browser gave:

```css
html { -webkit-tap-highlight-color: transparent; }
.button { transition: transform 150ms ease-out; }
.button:active { transform: scale(0.97); }
```

### Controls aren't selectable; content is

Long-pressing a button selects its label on iOS; long-pressing a link pops the callout. Apply this to controls only, never to `body` or a layout wrapper:

```css
button, [role="button"], .tab, .chip, .drag-handle {
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
```

## iOS Safari quirks

| Symptom | Cause | Fix |
| --- | --- | --- |
| Page zooms when an input is focused | Input text under 16px | 16px on coarse pointers ([forms.md](forms.md)); never `maximum-scale=1` |
| Video opens fullscreen or won't autoplay | Missing `muted` / `playsinline` | Add both (below) |
| Hover state sticks after a tap | Ungated `:hover` | `@media (hover: hover) and (pointer: fine)` |
| JS hover fires after a tap | Emulated mouse `pointerenter` | Check `pointerType`, ignore mouse for 50ms after touch |
| Tap feels delayed | Double-tap-zoom wait | `touch-action: manipulation` |
| Grey flash on tap | Tap highlight | `-webkit-tap-highlight-color: transparent` plus `:active` |
| Long-press selects button text | Selectable control label | `user-select: none` on controls |
| Keyboard pops open on page load | Autofocus on touch | Autofocus on fine pointers only ([forms.md](forms.md)) |
| `100vh` overflows, bottom CTA hidden | URL bar | `dvh` / `svh` ([mobile.md](mobile.md)) |
| Content under the notch or home bar | No safe-area padding | `env(safe-area-inset-*)` with `viewport-fit=cover` ([mobile.md](mobile.md)) |

None of these reproduce reliably in device emulation. List them as checks on a real phone; never report them verified from code.

## Video

### `muted` and `playsinline`

Without both, iOS refuses to autoplay or opens the video fullscreen. In React the prop is `playsInline`.

```html
<video muted playsinline loop preload="metadata" poster="poster.jpg">
  <source src="video.mp4" type="video/mp4" />
</video>
```

### No `autoplay` attribute when motion matters

The server can't know the reduced-motion preference, so start playback from script after checking it. Under `reduce`, don't autoplay; show controls. Autoplay can also be refused (Low Power Mode, data saver), so fall back to controls when `play()` rejects:

```jsx
const videoRef = useRef(null);
const [showControls, setShowControls] = useState(false);

useEffect(() => {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  const sync = () => {
    if (query.matches) {
      videoRef.current?.pause();
      setShowControls(true);
    } else {
      videoRef.current?.play().catch(() => setShowControls(true));
    }
  };
  sync();
  query.addEventListener("change", sync);
  return () => query.removeEventListener("change", sync);
}, []);

<video ref={videoRef} controls={showControls} muted loop playsInline />
```

Decorative background video gets `aria-hidden="true"`. Video with meaning needs captions and a visible pause control.

## Keyboard navigation

### Real elements

Actions are `<button>`, navigation is `<a href>`. A `<div onClick>` is not focusable, not reachable by Tab, doesn't fire on Enter or Space, and isn't announced. A card whose whole surface is one `<a>` reads the entire card as one link and blocks text selection; give it a distinct link instead.

### Tab order includes only what's visible

An off-screen drawer or collapsed panel hidden with `opacity: 0`, `transform`, or `height: 0` is still tabbable. Keyboard users land on invisible controls and screen readers read the closed menu aloud.

```css
.panel[data-closed] { visibility: hidden; } /* out of the tab order and the accessibility tree */

/* Keep an exit animation: flip visibility after it ends */
.panel { transition: transform 200ms ease-out, visibility 0s; }
.panel[data-closed] { transition: transform 200ms ease-out, visibility 0s 200ms; }
```

```jsx
<aside inert={!isOpen}>…</aside>
```

`display: none` also works when the panel doesn't animate.

### DOM order matches visual order

Tab and screen readers follow the DOM. `order: -1`, `row-reverse`, `column-reverse`, or absolute positioning that reorders visually makes focus jump around the screen. Reorder the markup, not the CSS. Positive `tabindex` values are always wrong; use `0` (focusable in order) or `-1` (focusable by script only).

### Focus never lands under sticky chrome or off-screen

The browser scrolls a focused element into view; reserve the space a sticky header covers so it lands clear of it:

```css
html { scroll-padding-top: 64px; } /* the sticky header's height */
[id] { scroll-margin-top: 64px; }  /* in-page anchor targets */
```

Focusable items inside horizontal scrollers or clipped containers scroll themselves into view on focus: `e.target.scrollIntoView({ block: "nearest" })`. No smooth behavior here; keyboard-driven movement doesn't animate.

### Skip link

Pages with long navigation get one, or keyboard users tab through every nav item on every page:

```html
<a href="#main" class="skip-link">Skip to content</a>
<main id="main">…</main>
```

```css
.skip-link { position: absolute; left: -9999px; }
.skip-link:focus-visible { left: 16px; top: 16px; }
```

### Widget keys

Composite widgets (menus, listboxes, tabs, radio groups, grids) are one Tab stop with arrow keys inside, using roving `tabindex` or `aria-activedescendant`. Home/End jump to the ends. Primitives (Base UI, Radix, React Aria) do this; a hand-built widget must follow the WAI-ARIA pattern for its role. Menu keyboard behavior is in [interaction-details.md](interaction-details.md).

## Visible focus

`outline: none` with no replacement makes keyboard navigation blind. Replace, don't remove. Use `:focus-visible` so mouse clicks don't show the ring:

```css
:focus-visible {
  outline: 2px solid var(--gray-12);
  outline-offset: 2px;
}
```

- **Keep the ring grey, black, or white.** Brand-colored outlines clash with the interface. It needs 3:1 against its background.
- **A ring clipped by `overflow: hidden`** on the parent is the same failure. Move it inside with a negative `outline-offset`, or lift the clip.
- **Hunt for** `outline: none`, `outline: 0`, Tailwind `outline-none` without a `focus-visible` rule beside it. A global reset is the usual culprit.

## Focus management

### Modals and dialogs

- When it opens, focus moves into it: the first interactive element, or the dialog itself.
- While open, Tab can't escape to the page behind, and the page behind is `inert`.
- Escape closes it.
- When it closes, focus returns to the element that opened it. Focus left on a removed node falls to `<body>` and the user re-tabs from the top.

Use a primitive that does all of this: Base UI, Radix, or native `<dialog>` with `showModal()` (which makes the rest of the page inert). A hand-rolled `position: fixed` overlay toggled by state is the finding; swap in the project's primitive rather than building a focus trap from scratch.

### `inert`

`inert` removes a subtree from focus, pointer events, and the accessibility tree in one attribute. Use it for content behind a non-native modal, closed drawers that stay mounted, and off-screen carousel slides.

### Focus after removals

Deleting the focused row, closing a popover, or unmounting the element just activated drops focus to `<body>`. After a removal, move focus to the next item, the previous one, or the list's heading. Popovers and menus return focus based on how they closed ([interaction-details.md](interaction-details.md)).

### Autofocus

Autofocus the first input in a modal on fine pointers only; on touch it opens the keyboard unexpectedly ([forms.md](forms.md)).

## Screen readers

### Icon-only buttons have a name

A button whose only child is an SVG is announced as "button". The label names the action, never the element or the icon.

```html
<!-- Wrong -->
<button aria-label="icon"><SearchIcon /></button>
<button aria-label="close icon"><CloseIcon /></button>

<!-- Right -->
<button type="button" aria-label="Search"><SearchIcon aria-hidden="true" /></button>
<button type="button" aria-label="Close dialog"><CloseIcon aria-hidden="true" /></button>
```

Decorative icons next to visible text get `aria-hidden="true"` so the label isn't read twice.

### Images and code-built illustrations

A decorative illustration is hidden; a meaningful one gets a role and a label that says what it shows:

```jsx
<div aria-hidden="true" className="decorative-illustration" />
<div role="img" aria-label="Upload progress: 3 of 5 files" className="progress-illustration" />
<img src="hero.webp" alt="" />        {/* decorative */}
<img src="chart.png" alt="Revenue doubled from March to June" />
<svg aria-hidden="true">…</svg>       {/* decorative icon */}
```

A missing `alt` on the only product shot is a blocker; screen readers fall back to the filename.

### Announce async changes

A toast, a form result, or a "3 results" count that appears silently doesn't exist for a screen reader user.

```jsx
<div role="status" aria-live="polite">{message}</div> {/* confirmations, counts */}
<div role="alert">{error}</div>                       {/* errors needing attention now */}
```

The live region must exist in the DOM before the message is put into it, or nothing is announced. Sonner and common toast primitives handle this; hand-rolled toasts usually don't.

### State isn't color-only

A red border alone is invisible to colorblind users and silent to screen readers. Pair color with an icon and text, and expose state through ARIA: `aria-invalid`, `aria-expanded`, `aria-pressed`, `aria-checked`, `aria-current="page"`.

### Page structure

- One `<main>`, one `<h1>`, heading levels that don't skip (`h1` → `h4`) because the size looked right. Pick the level from the outline and the size from the type scale.
- `<html lang="…">` set.
- `document.title` updates on client-side route changes, so tabs and screen readers can tell pages apart.
- Landmarks (`<header>`, `<nav>`, `<main>`, `<footer>`) so users can jump between regions.

### ARIA rules of thumb

- Prefer a native element over a role: `<button>` over `role="button"`, `<dialog>` over `role="dialog"` on a div.
- Don't use `aria-label` on non-interactive generic elements (`div`, `span`); many screen readers ignore it there. Use visible text or `role="img"`.
- `aria-hidden="true"` never goes on something focusable.

## Time-limited actions

Presentation timers (toasts, undo windows, auto-advancing slides) pause on `visibilitychange` and window `blur`, as well as hover, press, and focus, and resume from what was left. Those reasons overlap, so the timer tracks why it's paused; the implementation is in [interaction-details.md](interaction-details.md). Real deadlines (session expiry, a reservation hold) never pause; they recompute what's left from the absolute end time when the tab returns. Toasts stay 4000ms, 6000ms with an action, never a flat 2s.

## Keyboard shortcuts per OS

Show `⌘` / `Cmd` on Apple platforms and `Ctrl` elsewhere, and bind the matching key. Read the platform in an effect, not during an SSR render. `navigator.platform` is deprecated and `userAgentData` is Chromium-only, so fall back to the UA string:

```js
const platform = navigator.userAgentData?.platform ?? navigator.userAgent;
const isMac = /mac|iphone|ipad/i.test(platform);
const modKey = isMac ? "⌘" : "Ctrl";

const isMod = (e) => (isMac ? e.metaKey : e.ctrlKey);
```

"⌘K" shown on Windows is a lie.

## Reduced motion

`prefers-reduced-motion: reduce` means remove the movement and keep the meaning: a modal that scales in fades in instead; a sliding sidebar fades. Never zero out feedback entirely; the blanket `* { animation: none !important; transition: none !important; }` removes the fades that tell the user something happened.

```css
.modal { animation: scale-in 200ms ease-out; }
@media (prefers-reduced-motion: reduce) {
  .modal { animation: fade-in 200ms ease-out; }
}

@media (prefers-reduced-motion: no-preference) {
  html { scroll-behavior: smooth; } /* smooth scroll is opt-in */
}
```

Motion: `<MotionConfig reducedMotion="user">` at the root (its default is `"never"`). Tailwind: `motion-safe:` and `motion-reduce:`. Autoplaying video: above. GIFs, loops, parallax, and the full approach: [animation-performance-accessibility.md](animation-performance-accessibility.md).

## Test with real input

Attributes can be proven from code; the focus path and reading order can't. List as device checks: complete the main flow with only Tab, Enter, Escape, and arrows; turn on VoiceOver (Cmd+F5) and listen to a key screen top to bottom; tap through on a real phone. Report them as checks to run, never as verified.

## Checklist

- [ ] Hover styles inside `@media (hover: hover) and (pointer: fine)`; nothing reachable only by hover; hover reveals also reveal on `:focus-within`
- [ ] Every tap target is at least 44px, with no overlapping hit areas
- [ ] `touch-action: manipulation` on controls; gesture surfaces hand back the axes they don't own
- [ ] Tap highlight removed and replaced by `:active` feedback; controls are `user-select: none`, content stays selectable
- [ ] Video has `muted` and `playsinline`, starts from script after the reduced-motion check, and falls back to controls
- [ ] Real `<button>` and `<a href>` elements; DOM order matches visual order; no positive `tabindex`
- [ ] Hidden panels are `inert` or `visibility: hidden`; focus lands clear of sticky chrome
- [ ] Visible `:focus-visible` ring in grey, black, or white, never clipped
- [ ] Modals move focus in, trap it, close on Escape, and restore it to the trigger; removals move focus somewhere sensible
- [ ] Icon-only buttons have an action `aria-label`; decorative visuals `aria-hidden`, meaningful ones `alt` or `role="img"` + label
- [ ] Async results announced through a pre-existing live region; state isn't color-only
- [ ] Timers pause when the tab is hidden; shortcuts show and bind Cmd or Ctrl per OS; every animation has a reduced-motion variant
