# CSS Animation

How to implement motion with CSS alone: transitions vs keyframes, enter/exit without a library, transforms and 3D, `clip-path` reveals, stagger, hover patterns, loops, SVG line drawing, and WAAPI when JavaScript has to start the animation. Read this when writing the code; the easing, duration, and whether-to-animate decisions are in [animation-principles.md](animation-principles.md).

## When CSS is the right tool

CSS is the default. Use it for:

- Hover, press, and color effects.
- Enter and exit of dropdowns, modals, popovers, sheets, and toasts, including sheets of unknown height (`translateY(100%)` always hides an element by exactly its own height). Use Radix `[data-state]` or Base UI `[data-starting-style]` / `[data-ending-style]`. Don't add Motion for these.
- Infinite constant loops: marquees, spinners.
- Bundle-sensitive projects.

CSS `transform` and `opacity` animations usually run on the compositor, off the main thread, so they stay smooth while the page is busy. A `requestAnimationFrame`-driven JS animation drops frames as the main thread fills.

Reach for a library when CSS can't do it: real springs, layout and shared-element animation, exits of elements React already unmounted, momentum gestures, or complex multi-step choreography. CSS has no real springs, so iOS-level polish on gesture-driven motion isn't reachable in plain CSS. If a library gets a clearly better result, use it. See [animation-motion-react.md](animation-motion-react.md).

## Transition or keyframes

Ask who drives the change.

| Use a transition when | Use `@keyframes` when |
| --- | --- |
| The user triggers it (hover, click, open/close, state change) | It runs on its own (page intro) |
| It can be interrupted or retargeted mid-flight | It loops forever (marquee, spinner) |
| The end state can change while moving (a toast stack shifting) | It has multiple steps (pulse, blink, shake) |
| | It's a one-shot that never gets interrupted |

**Transitions are interruptible; keyframes are not.** A transition interpolates from the element's current value toward the newest target and takes only as long as the remaining distance needs. A keyframe animation plays a fixed timeline from frame one; interrupt it and it snaps back and replays.

```css
/* Right: closing mid-open reverses from the current position */
.side-panel { transform: translateX(100%); transition: transform 240ms cubic-bezier(0.32, 0.72, 0, 1); }
.side-panel[data-open] { transform: translateX(0); }

/* Wrong: closing mid-open jumps, then replays */
.side-panel[data-open] { animation: panel-in 240ms ease-out forwards; }
```

## Transitions

```css
.button { transition: transform 200ms ease; }
```

- **Put the transition on the base state**, not only on `:hover` or `[data-open]`. Otherwise the return to default is instant.
- **Never `transition: all`.** It animates properties you didn't intend (including layout ones off the GPU). Name them. For several properties sharing timing, use `transition-property`:
  ```css
  .button {
    transition: 200ms ease;
    transition-property: color, background-color, border-color;
  }
  ```
- **Write `ease` explicitly** even though it's the default; many people assume the default is linear.
- **Declare `transition-delay` on its own line.** `transition: transform 0.2s ease 1s` is hard to read.
- Individual transform properties (`scale`, `translate`, `rotate`) can transition independently of `transform`: `transition: scale 150ms ease-out; .x:active { scale: 0.97; }`.

### Asymmetric transitions

Declare different transitions on the two states. The transition on the state being entered is the one that runs.

```css
.overlay { transition: opacity 150ms ease-out; }                                     /* closing: fast */
.overlay[data-open] { transition: opacity 250ms cubic-bezier(0.32, 0.72, 0, 1); }   /* opening */
```

## Keyframes

```css
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
.el { animation: fade-in 200ms ease-out; }
```

- Use the shorthand for name, duration, timing function; declare the rest on their own lines.
- **Omit `from`/`to` and CSS uses the element's current values.** `@keyframes blink { 50% { visibility: hidden; } }` is a complete blink. An exit keyframe with only `to` animates out from wherever the element is.
- `animation-fill-mode: forwards` keeps the end state (without it, the element snaps back). `backwards` applies the first keyframe during the delay, which stops a delayed entrance from flashing its final state first. `both` does both.
- `animation-iteration-count: infinite` for loops; counts between 1 and infinite are rarely worth it.
- `animation-direction: alternate` plays back and forth instead of teleporting to the start.
- `animation-play-state: paused` pauses; transitions can't.
- Re-trigger a keyframe animation in React by changing the element's `key`.
- Many steps usually means the wrong tool; choreography is easier in a library.
- **Put the hidden state in the keyframe's `from`**, never in a base `opacity: 0` that only the animation clears. If the animation never runs (reduced motion, a failed class), content stays visible.

## Enter and exit without a library

### @starting-style

Animates an element in on first render or when it goes from `display: none` to shown. No mount state, no `useEffect`.

```css
.toast {
  opacity: 1;
  transform: translateY(0);
  transition: opacity 250ms ease-out, transform 250ms ease-out;

  @starting-style {
    opacity: 0;
    transform: translateY(100%);
  }
}
```

To also animate out of `display: none` (a `<dialog>` or `[popover]`), transition `display` and `overlay` with `allow-discrete`:

```css
.popover {
  opacity: 1; scale: 1;
  transition: opacity 150ms ease-out, scale 150ms ease-out,
              display 150ms allow-discrete, overlay 150ms allow-discrete;
  @starting-style { opacity: 0; scale: 0.95; }
}
.popover:not(:popover-open) { opacity: 0; scale: 0.95; }
```

Legacy fallback: render the initial state, flip a `data-mounted` attribute in `useEffect(() => setMounted(true), [])`, and transition to the target.

### Radix: data-state

Radix keeps the element mounted while a closing animation runs on `[data-state="closed"]`, so keyframes work for its open/close:

```css
@keyframes scale-in  { from { opacity: 0; scale: 0.95; } }
@keyframes scale-out { to   { opacity: 0; scale: 0.95; } }  /* no `from`: exits from current state */

.content { transform-origin: var(--radix-dropdown-menu-content-transform-origin); }
.content[data-state="open"]   { animation: scale-in 150ms cubic-bezier(0.23, 1, 0.32, 1); }
.content[data-state="closed"] { animation: scale-out 120ms ease-out; }
```

These are one-shots per state change. If the user can rapidly toggle the element (an accordion, a frequently reopened panel), prefer a transition on `[data-state]` so it retargets.

### Base UI: data-starting-style / data-ending-style

Base UI sets these attributes for the first and last frame, so a plain transition handles both directions and stays interruptible:

```css
.popup {
  transform-origin: var(--transform-origin);
  transition: opacity 150ms ease-out, transform 150ms ease-out;
}
.popup[data-starting-style],
.popup[data-ending-style] { opacity: 0; transform: scale(0.95); }
```

### Paired elements

Give overlay and content identical timing:

```css
.overlay { opacity: 0; transition: opacity 200ms cubic-bezier(0.32, 0.72, 0, 1); }
.modal {
  opacity: 0; transform: scale(0.97);
  transition: opacity 200ms cubic-bezier(0.32, 0.72, 0, 1), transform 200ms cubic-bezier(0.32, 0.72, 0, 1);
}
.overlay[data-open] { opacity: 1; }
.modal[data-open]   { opacity: 1; transform: scale(1); }
```

### Icon swap without a library

Render both icons at once, stack them in one grid cell, and cross-fade with classes. Nothing unmounts, so both directions animate.

```css
.icon-swap { display: grid; }
.icon-swap > * {
  grid-area: 1 / 1;
  transition: opacity 300ms cubic-bezier(0.25, 0.1, 0, 1), scale 300ms cubic-bezier(0.25, 0.1, 0, 1), filter 300ms cubic-bezier(0.25, 0.1, 0, 1);
}
.icon-swap > [data-hidden] { opacity: 0; scale: 0.3; filter: blur(3px); }
```

## Transforms

`transform` changes how an element looks without affecting document flow; siblings lay out as if it never moved.

- **Translate percentages are relative to the element's own size.** `translateY(100%)` moves it by exactly its own height. Sonner and Vaul position toasts and drawers this way. Prefer percentages over hardcoded px even when dimensions are fixed; they're less error-prone. Prefer `translateX`/`translateY` over `translate(x, y)` for readability.
- **Scale scales the children too** (font size, icons, `border-radius`), which is what you want for press feedback and zoom. `scaleX`/`scaleY` alone usually looks bad.
- **Rotation alone looks best with ease-in-out**; constant rotation (loaders, coins) uses linear.
- **Order matters.** `rotate(45deg) translateX(100px)` lands somewhere different from `translateX(100px) rotate(45deg)`.
- **`transform-origin`** defaults to center. Set it to the trigger for popovers (see [animation-principles.md](animation-principles.md)).
- **Inline elements can't be transformed.** Give a `<span>` `display: inline-block` first.

### 3D

```css
.parent {
  transform-style: preserve-3d;  /* children live in real 3D space */
  perspective: 500px;            /* viewer distance; smaller = more dramatic */
}
.child {
  transform: rotateY(20deg) translateZ(74px);
  backface-visibility: hidden;   /* hide the reverse face */
}
```

- `rotateY` turns like a revolving door; `rotateX` like a rotisserie.
- `translateZ` (positive toward the viewer) is invisible without `perspective` on the parent.
- Without `preserve-3d` there is no depth, so a child can never pass behind a sibling.

**Orbit:** `rotateY` sweeps the revolution, `translateZ` sets the radius, and a trailing counter-rotation keeps the element facing front. Linear, because orbits don't accelerate; slow it down if it's ambient.

```css
.orbiter { animation: orbit 6s linear infinite; }
@keyframes orbit {
  from { transform: translate(-50%, -50%) rotateY(0deg)   translateZ(74px) rotateY(360deg); }
  to   { transform: translate(-50%, -50%) rotateY(360deg) translateZ(74px) rotateY(0deg); }
}
```

**Coin flip:** two faces with `backface-visibility: hidden` (front `translateZ(3px)`, back `rotateY(180deg) translateZ(3px)`), a rim (`translateX(26px) rotateY(90deg); width: 6px`), and a parent rotating `rotateY(360deg)` linearly.

### Stacked cards (collapsed toast stack)

Drive scale and offset from an inverted `--index` so cards can be added without touching CSS:

```css
.card {
  --scale-increment: 0.05;
  --translate-increment: -13%;
  transform:
    scale(calc(1 - var(--index) * var(--scale-increment)))
    translateY(calc(var(--index) * var(--translate-increment)));
}
```

```tsx
{cards.map((c, i) => <div className="card" key={c.id} style={{ "--index": cards.length - 1 - i }} />)}
```

The front card is index 0. Don't update a per-frame CSS variable on a shared parent to drive many children; that recalculates styles for every descendant (see [animation-performance-accessibility.md](animation-performance-accessibility.md)).

### Toast stack (interruptible enter)

New toasts push the stack up. One may arrive while the previous is still moving, so this is a transition.

```css
.toast {
  position: absolute;
  bottom: 0;
  transform: translateY(calc(var(--index) * (100% + var(--gap)) * -1));
  opacity: 1;
  transition: opacity 400ms ease, transform 400ms ease;
  @starting-style { opacity: 0; transform: translateY(100%); }
}
```

Invert the index so the newest toast is 0 at the bottom. `100%` assumes equal heights; with mixed heights, measure each toast and offset by the sum of the heights in front of it, as Sonner does.

## clip-path

`clip-path` hides everything outside a shape. Like `transform` it has no layout effect and is hardware-accelerated, so it beats animating `width`/`height` for most reveals, and there's no layout shift because the content is already laid out.

`inset(top right bottom left)` does nearly all the work, offsets like `margin`:

- `inset(0)`: fully visible.
- `inset(100%)`: fully hidden.
- `inset(0 50% 0 0)`: right half hidden.
- `inset(0 0 0 0 round 12px)`: rounded clip.

### Image reveal on scroll

Animate `inset(100%)` → `inset(0)` (or `inset(0 0 100% 0)` → `inset(0)` to wipe from the top). Trigger it when the image enters the viewport, once, with IntersectionObserver; if Motion is already installed, `useInView(ref, { once: true, margin: "-100px" })`. Never add a library for this. See [animation-gestures-scroll.md](animation-gestures-scroll.md).

### Comparison slider

Overlay two images; clip the top one with `clip-path: inset(0 var(--pos) 0 0)` driven by drag. More performant than two `overflow: hidden` divs and needs no extra DOM. The same trick on two versions of the same text (outlined and solid) gives a text mask.

### Seamless tab highlight

Transitioning text color in sync with a moving pill never lines up. Instead, duplicate the tab list, style the copy as if every tab were active (filled background, inverted text), stack it on top, and clip it to the active tab. Moving the highlight is one `clip-path` transition, and the colors are always already correct.

### Theme switch wipe

Render both themes stacked and animate the `clip-path` of one. It's a fast prototype; the production route is the View Transitions API.

### Hold to delete

```css
.button { position: relative; transition: transform 160ms cubic-bezier(0.25, 0.46, 0.45, 0.94); }
.button:active { transform: scale(0.97); }

.hold-overlay {
  position: absolute;
  inset: 0;
  background: #ffdbdc;
  color: #e5484d;
  clip-path: inset(0 100% 0 0);          /* hidden from the right */
  transition: clip-path 200ms ease-out;  /* release: fast snap-back */
}
.button:active .hold-overlay {
  clip-path: inset(0);
  transition: clip-path 1.5s linear;     /* hold: slow, even progress */
}
```

Duplicate the button's label and icon inside the overlay so the wipe reveals a red copy. The two transitions are the recipe: one shared timing would make cancelling feel broken.

## Expanding height

Animating `height` triggers layout every frame. Options, in order of preference:

1. `clip-path` or `transform` if the content can be clipped or slid rather than reflowed.
2. `grid-template-rows: 0fr` → `1fr` on a grid wrapper with an `overflow: hidden` child. It still animates layout, so keep it to small regions like an accordion.
3. Measure and animate to a pixel value with a library (see [animation-motion-react.md](animation-motion-react.md)).

```css
.collapsible { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 200ms cubic-bezier(0.25, 1, 0.5, 1); }
.collapsible[data-open] { grid-template-rows: 1fr; }
.collapsible > .inner { overflow: hidden; }
```

## Stagger

Split into per-item elements, pass an index, delay by it. The hidden state lives in the keyframe's `from`, held during the delay by `backwards`.

```css
.entrance > * {
  animation: rise-in 350ms cubic-bezier(0.23, 1, 0.32, 1) backwards;
  animation-delay: calc(var(--i, 0) * 100ms);   /* hero blocks; 30–50ms for list items */
}
@keyframes rise-in { from { opacity: 0; translate: 0 8px; filter: blur(2px); } }
```

### Text reveal

```css
.headline { overflow: hidden; }                 /* hides letters' parked position */
.headline span {
  display: inline-block;                         /* transforms need a box */
  animation: reveal 1.3s cubic-bezier(0.19, 1, 0.22, 1) backwards;
  animation-delay: calc(0.03s * var(--i));       /* small: delays accumulate */
}
@keyframes reveal { from { transform: translateY(100%); } }
```

Each of these breaks it on its own: missing `inline-block`, missing `overflow: hidden`, missing `backwards`, or a per-letter delay that's too large. Keep the total within the budget in [animation-principles.md](animation-principles.md); per-letter reveals are for rare marketing moments.

## Hover

### Gate hover to real pointers

Tapping on touch devices fires hover, which is accidental almost every time. Gate hover effects:

```css
@media (hover: hover) and (pointer: fine) {
  .card:hover { background: var(--gray-2); }
}
```

Tailwind v4's `hover:` variant already does this, so don't add a gate around it. In Tailwind v3, set `future.hoverOnlyWhenSupported`.

### Pair information-revealing hover with focus

If hover reveals real information, keyboard users need it too. Use `:focus-visible` (keyboard focus), not `:focus` (also fires on click).

```css
.card:hover .card-description,
.card:focus-visible .card-description { transform: translateY(0); }
```

### Hover lift without flicker

Moving the hovered element can move it out from under the cursor, ending hover, dropping it back, starting hover again. Keep the hover target still and move a child.

```css
.box-inner { transition: transform 200ms ease; }
.box:hover .box-inner { transform: translateY(-20%); }
```

### Card hover reveal

```css
.card { overflow: hidden; }
.card-description {
  --margin: 6px;
  margin: var(--margin);
  /* own height + margin, +1px if an outside shadow acts as a border */
  transform: translateY(calc(100% + var(--margin) + 1px));
  transition: transform 500ms cubic-bezier(0.19, 1, 0.22, 1);
}
.card:hover .card-description,
.card:focus-visible .card-description { transform: translateY(0); }
```

500ms works here only because the curve is so steep at the start.

### Two elements, one motion (download arrow)

```css
.download { display: grid; place-items: center; overflow: hidden; }
.download svg { grid-area: 1 / 1; transition: transform 200ms cubic-bezier(0.785, 0.135, 0.15, 0.86); }
.download svg:first-of-type { transform: translateY(-150%); }          /* parked above */
.download:hover svg:first-of-type { transform: translateY(0); }
.download:hover svg:last-of-type  { transform: translateY(150%); }
```

`grid-area: 1 / 1` is the cleanest way to stack elements. Use 150% when the element is smaller than its container, since its own height won't clear the edge.

## Loops

### Spinner

```css
.spinner { animation: spin 600ms linear infinite; }
@keyframes spin { to { rotate: 360deg; } }
```

Faster spinners make loading feel faster.

### Marquee

Duplicate the content once and translate the track by half its width, linearly:

```css
.marquee { overflow: hidden; }
.marquee-track { display: flex; width: max-content; animation: marquee 30s linear infinite; }
@keyframes marquee { to { transform: translateX(-50%); } }
```

Mark the duplicate `aria-hidden="true"`. Pause loops when off-screen (IntersectionObserver toggling `animation-play-state: paused`) to save CPU and battery, and offer a pause control for long-running motion.

### Ambient motion

Barely perceptible float or rotation on idle illustrations, using non-syncing durations (e.g. a 3s float and a 4s rotate, `alternate`, ease-in-out) so layers never line up and it reads organic. Give attention-seeking loops an initial delay (~2s) so users find the interaction first.

## Theme switching

Toggling dark mode should not fire every color transition on the page. Disable transitions for the swap; the snippet is in [surfaces.md](surfaces.md#theme-switching).

## SVG

### Fundamentals

- SVG has no document flow; unpositioned elements stack at `(0, 0)`.
- `viewBox="minX minY width height"` is the camera. It scales responsively and keeps animation values constant at any display size.
- Close paths with `Z`; an open path whose ends meet shows an awkward corner.
- Degenerate shapes (`width="0"`, `r="0"`, a line whose start equals its end) don't render at all, unlike `opacity: 0`.
- Put `overflow: visible` on the `<svg>` so scale or overshoot doesn't clip. Nest `<g>` groups to layer independent transforms.

### Line drawing

Make one dash as long as the path with a larger gap, offset it by the full length to hide it, then animate the offset to 0.

```html
<path pathLength="1" class="draw" d="..." />
```

```css
.draw {
  stroke-dasharray: 1px 1.1px;   /* gap slightly larger than the dash */
  stroke-dashoffset: 1px;
  animation: draw 600ms cubic-bezier(0.23, 1, 0.32, 1) forwards;
}
.check { animation-delay: 600ms; }  /* a checkmark waits for its box */
@keyframes draw { to { stroke-dashoffset: 0; } }
```

- `pathLength` normalizes length so values are shared across paths of different real lengths (`pathLength="1"` or `"100"`). Without it, the values are real pixels.
- `forwards` is required or the stroke snaps back to hidden.
- With `stroke-linecap: round`, caps extend past the dash, so the gap must exceed the dash or the caps peek through.
- Stagger strokes with `animation-delay`.

### transform-origin in SVG

SVG `transform-origin` defaults to the viewBox `(0, 0)`, and `center` means the center of the viewBox, not the element.

```css
/* Usually: make origin relative to the element's own box */
.icon-part { transform-box: fill-box; transform-origin: center; }

/* Or rotate around a specific point in viewBox coordinates */
.clock-hand { transform-box: view-box; transform-origin: 50px 50px; }
```

For a zero-thickness line, `transform-origin: 0% 100%` hits the start point. Motion sets `transform-box: fill-box` and overrides a `transformOrigin` in `style`; see [animation-motion-react.md](animation-motion-react.md).

### Shakes

Decaying, alternating keyframes, applied to a wrapping `<g>` so nested parts shake along:

```css
@keyframes bell {
  0%, 100% { rotate: 0deg; } 10% { rotate: 20deg; } 20% { rotate: -15deg; } 30% { rotate: 12.5deg; }
  40% { rotate: -10deg; } 50% { rotate: 10deg; } 60% { rotate: -7.5deg; } 70% { rotate: 7.5deg; }
  80% { rotate: -5deg; } 90% { rotate: 5deg; }
}
```

Path morphing (`d` interpolation) needs matching point structure or an interpolation library; see [animation-motion-react.md](animation-motion-react.md).

## WAAPI

Use the Web Animations API when JavaScript must start, sequence, or reverse an animation but the motion is predetermined: it keeps CSS-like performance (transform and opacity can run off the main thread) without a library.

```js
const anim = el.animate(
  [{ opacity: 0, transform: "scale(0.95)" }, { opacity: 1, transform: "scale(1)" }],
  { duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "forwards" }
);

anim.reverse();            // retargets from the current point, not from the start
await anim.finished;       // sequence or clean up after it ends
anim.commitStyles();       // write the end state into inline style
anim.cancel();             // then drop the animation (avoids stacking fill:forwards animations)
```

- Prefer WAAPI over a `requestAnimationFrame` loop for anything that runs while the page is busy (navigation, hydration, large lists).
- Animating per-frame values that follow a pointer is not WAAPI's job; use a motion value or direct style writes (see [animation-gestures-scroll.md](animation-gestures-scroll.md)).

## Reduced motion

Swap movement for a fade rather than deleting the animation, and keep content visible if nothing runs:

```css
.modal { animation: modal-in 200ms ease-out; }
@keyframes modal-in { from { opacity: 0; scale: 0.97; } }
@keyframes fade-in  { from { opacity: 0; } }

@media (prefers-reduced-motion: reduce) {
  .modal { animation-name: fade-in; }
}
```

Full rules in [animation-performance-accessibility.md](animation-performance-accessibility.md).

## Reverse engineering

When a CSS animation impresses you, open DevTools: properties, durations, and curves are all there. The Animations panel can slow playback to 10% and scrub. Curate a short list of sites worth studying (Vercel, Linear) rather than copying from anywhere.

## Checklist

- Toggled or interruptible UI uses transitions; keyframes only for loops and one-shots.
- Transition lives on the base state, lists explicit properties, never `all`.
- Hidden state lives in the keyframe's `from` (or `@starting-style`), with `backwards` on delayed enters, so content is visible if the animation doesn't run.
- Enter/exit uses `@starting-style`, Radix `[data-state]`, or Base UI `[data-starting-style]`/`[data-ending-style]` instead of adding a library.
- Translate uses percentages for elements of variable size; inline elements get `inline-block` before transforming.
- Reveals use `clip-path: inset()` instead of animating `width`/`height`.
- Hover motion is gated with `@media (hover: hover) and (pointer: fine)` (not around Tailwind v4 `hover:`), information-revealing hover also responds to `:focus-visible`, and lifts move a child.
- Loops are `linear`, pause off-screen, and duplicated marquee content is `aria-hidden`.
- SVG transforms set `transform-box: fill-box` (or explicit view-box origin); line drawing uses `pathLength` and `forwards`.
- Transitions are disabled during theme switches.
- Every animation has a `prefers-reduced-motion` variant that swaps movement for opacity.
