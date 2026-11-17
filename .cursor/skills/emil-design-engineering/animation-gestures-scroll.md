# Gestures and Scroll Animation

How to build drag, swipe, sheet, and hold interactions that track the pointer and stay interruptible, and how to build scroll-triggered and scroll-driven animation with restraint. Read it before writing any pointer handler, `drag` prop, `onDragEnd` threshold, `IntersectionObserver` reveal, or `animation-timeline`. Motion API details are in [animation-motion-react.md](animation-motion-react.md); frame-budget rules are in [animation-performance-accessibility.md](animation-performance-accessibility.md).

## Build it, or use a library

A drawer done right needs momentum dragging, overlay opacity tied to drag progress, velocity-aware dismissal, scroll/drag disambiguation, focus trapping, and Escape-to-close. That is weeks of edge cases.

- Bottom sheet or drawer: **Vaul**. Swipeable toast: **Sonner**. Reorder: **dnd-kit** or React Aria.
- Build the gesture yourself only when no library covers it (custom swipe cards, bespoke drag panels).
- Asked to fix a hand-written one: fix it in place with the rules below and mention the library in your report. Don't migrate unasked.

## The two phases

Every gesture has two phases. Mixing them up is the main reason gestures feel wrong.

```
Is the pointer down?
├── Yes → TRACK: position maps 1:1 to the pointer. No easing, no duration, no spring.
└── No  → RELEASE: a spring seeded with the release velocity finishes the motion. Never a keyframe.
```

## 1. Starting: should this pointerdown become a drag?

Walk these on `pointerdown` and the first `pointermove`. Any "no" leaves the gesture to the browser (scroll, select, click).

```
Primary button? (e.button === 0)
└── No → not a drag. Right-click opens the context menu.
Started on a child with its own gesture (input, textarea, select, slider, contenteditable, [data-no-drag])?
└── Yes → not a drag. Buttons and links are NOT on this list; they can start a drag past
          the threshold, and their click is swallowed if it became one.
Text selected? (getSelection().toString().length > 0)
└── Yes → not a drag.
Container with scrollable content (sheet, drawer), pointer went down on that content:
│   Opened less than 500ms ago? → not a drag (still animating in, finger likely mid-scroll).
│   Any scrollable ancestor scrolled away from its start? → not a drag.
│   Content hit its top less than 100ms ago? → not a drag (a fast scroll overshooting the top must not close it).
│   Moving toward the open direction over content that can still scroll that way? → not a drag; the list scrolls.
│   (Handles, sliders, cards, floating panels skip these four.)
Moved past the start threshold on the drag axis?
├── Not yet → wait. 10px on touch, 2px with a mouse, 6px on a mouse-dragged panel full of buttons.
├── Moved further on the other axis → drop it. A horizontal swipe in a sheet is a carousel.
└── Yes → drag. It stays a drag until release.
```

- **Once allowed, always allowed.** Never re-run the checks mid-gesture.
- **Lock the axis** once decided, by whichever delta was larger past the threshold.
- **Anchor at the threshold crossing,** not at `pointerdown`, so the element starts from rest instead of jumping 10px to catch up.

## 2. Tracking: the element is the pointer

- **1:1, no transition.** Set `transition: none` on the element and anything linked to it when the drag starts; restore on release. In Motion, drive position from `useMotionValue`, never a spring.
- **Write `transform` on the dragged element itself.** Not React state per `pointermove` (a re-render per event drops frames), and not a CSS variable on a parent. CSS variables inherit, so each write recalculates styles for every descendant; this made a drawer lag with about 20 list items inside.
- **1:1 is for things being moved, not things reacting.** A sheet, slider, or card follows exactly. Decorative reactions (tilt, a glow following the cursor, a parallax layer) go through a spring. Anything carrying information (a chart crosshair, a value readout) is 1:1 again.
- **Ignore every pointer after the first** until release, or a second finger makes the element jump.
- **After the threshold,** set `user-select: none` and clear stray selection (`getSelection()?.removeAllRanges()`). Not before, so a press that never becomes a drag can still select text.
- **Pointer capture:** no buttons inside (sheet, toast) → capture on `pointerdown` so the drag survives leaving the element. Full of buttons (toolbar, panel) → capture only after the threshold, or the buttons' clicks retarget to the panel.
- **`preventDefault()` `dragstart` and `selectstart`** during the drag, or links and images start native drag-and-drop and Chrome cancels the pointer stream.
- **End exactly once, and know how it ended.** `pointerup` commits (run the release decision). `pointercancel`, `lostpointercapture` without `pointerup`, and `contextmenu` cancel: return to rest and never dismiss on velocity. **Escape also cancels** and returns the element to its start. Guard the end with a flag, since `lostpointercapture` also fires after a normal `pointerup`. Don't use `pointerout`; it bubbles from children.

### Linked values

Derive everything that reacts to the drag from the same progress value, so it can't drift, including mid-gesture and on reversal:

```jsx
const y = useMotionValue(0);
const overlayOpacity = useTransform(y, [0, drawerHeight], [1, 0]);
```

Two separately animated values fall out of sync the moment a gesture is interrupted.

## 3. Past the edge: tension, not a wall

At a limit (sheet fully open, slider at max, list at its first item) the element keeps following, but each extra pixel moves it less. A hard stop detaches the element from the pointer.

```
Can the element legitimately move further this way?
├── No, wrong direction (toast swiped up, sheet pulled above its top) → capped: gives a little, never more than ~20px.
└── Yes, but it's the end of its range (slider at max, list end)        → iOS rubber band.
```

```ts
// Capped. 10px → 5, 50px → 12.5, 100px → 15.4, never past `limit`.
function capped(delta: number, limit = 20) {
  return delta / (1.5 + Math.abs(delta) / limit);
}

// iOS rubber band. `dimension` = size of the dragged thing; bigger things stretch further.
function rubberBand(overshoot: number, dimension: number, c = 0.55) {
  const sign = Math.sign(overshoot);
  const x = Math.abs(overshoot);
  return sign * (1 - 1 / ((x * c) / dimension + 1)) * dimension;
}
```

- **Motion's `dragElastic` is linear.** `0.2` moves 20% of every pixel forever: a weaker drag, not tension. For real tension set `dragElastic={0}` and apply a curve above in `onDrag`, or drive the position from a motion value yourself.
- **Fill the gap the stretch opens.** A sheet rubber-banding upward exposes the page under its bottom edge:
  ```css
  .sheet::after { content: ""; position: absolute; top: 100%; left: 0; right: 0; height: 200%; background: inherit; }
  ```
- **A stretched control can change shape.** A slider track pulled past its end grows along the drag and thins across it: `scaleY = 1 - 0.3 * Math.min(1, stretch / 40)`. The value stays at its limit.
- **Release returns to the limit** on a spring, about 500ms, no bounce. Clamp derived values at 0 so spring overshoot never thickens the track or dips the value under its limit.
- A dampened direction can still produce a fast flick. Check the direction is allowed before velocity dismisses anything.

## 4. Letting go: distance or velocity

Distance alone ignores flicks: a fast short swipe snaps back and the user has to drag further than they meant to. Check both.

```
On release:
├── At or past rest, or moving toward it at release   → return.
├── Pulled back ≥10px from the furthest point reached → return, even past the distance threshold.
├── Velocity over threshold in an allowed direction    → go (dismiss, next snap point).
├── Distance over threshold                            → go.
└── Otherwise                                           → return, fast.
```

**A velocity threshold only works with the method it was tuned on.** The two methods are not interchangeable:

- **Gesture average:** total distance ÷ time since `pointerdown` (`swipeAmount / timeTaken`). What Sonner and Vaul compute. Reads much lower than release speed.
- **Release velocity:** speed over the last ~100ms. What Motion's `onDragEnd` gives as `info.velocity`, in px/s. Reads several times higher for the same flick.

| What's dragged | Distance | Gesture average | Release velocity |
| --- | --- | --- | --- |
| Toast swipe-to-dismiss | 45px | 0.11 px/ms | |
| Sheet / drawer close | 25% of its height | 0.4 px/ms | 500 px/s |
| Snap points: move one | dragged < 40% of viewport | > 0.4 px/ms: one point in the drag direction | |
| Snap points: skip | | > 2 px/ms: jump to the last point, or close | |

Small, light things dismiss on a gentler flick than big ones. Never pair a release velocity with a gesture-average number: at 110 px/s measured at release, almost any moving toast gets dismissed.

- **A pointer that sat still ~90ms before release placed the element; it didn't throw it.** Skip the velocity check and decide on distance.
- **Throwing to one of several targets** (a panel to a corner): project the release ~140ms ahead along the release velocity (cap ~400px) and pick the nearest target to the projected point. Above ~0.55 px/ms, pick the target best aligned with the throw direction.
- **`dragMomentum` is on by default and glides far:** it coasts to 0.8 × release velocity (1000 px/s → 800px) over a 750ms time constant. Fine for a free-floating canvas object. Anything that lands on a target (snap point, slot, corner) gets `dragMomentum={false}` and the decision above picks the target.

### After release

- **Finish on a spring seeded with release velocity** (`{ type: "spring", visualDuration: 0.5, bounce: 0 }`; `duration` springs ignore velocity). A fixed-duration ease makes every throw land the same.
- **Bounce only where the throw lands in view** (sheet to a snap point, card back into its slot), ≤ 0.2. A drag applies force, so a slight bounce reads as physical. The same element moved by a button press gets none. Something thrown off-screen gets none.
- **The exit starts where the finger left it** and continues in the swipe's direction.
- **Coming back is fast:** a spring around 300ms, no bounce. A slow snap-back reads as the UI arguing.
- **A grab mid-animation takes over.** Stop the running animation and hand the position to the pointer. Springs and transitions allow it; `@keyframes` restart from zero and can't be caught. Never put a keyframe animation on anything a gesture can touch.

### Motion drag, wired correctly

```jsx
<motion.div
  drag="y"
  dragConstraints={{ top: 0 }}
  dragElastic={0}            // apply a tension curve in onDrag instead
  dragMomentum={false}       // it lands on a target
  onDragEnd={(e, info) => {
    const far  = info.offset.y > sheetHeight * 0.25;
    const fast = info.velocity.y > 500; // px/s, release velocity
    if (far || fast) dismiss(); else snapBack();
  }}
/>
```

`dragConstraints` takes a ref or a bounds object. Motion's `drag` sets `touch-action` for you and suppresses hover on other elements during its own gestures.

## 5. After the drag

- **Swallow the click that ends a drag** started on a button: ignore clicks for ~300ms after the drag ends.
- **Don't let a flick focus an input:** ignore focus for ~200ms after a fast release.
- **Sheet handle:** a 250ms long-press cancels its tap action; a second tap within 120ms cancels the first. Its hit area is at least 44px: `width: max(100%, 44px); height: max(100%, 44px)` on an invisible child.
- **While dragging, nothing else reacts to hover.** No highlights, no tooltips.

## Drawers and sheets

- **The iOS sheet curve without springs:** `cubic-bezier(0.32, 0.72, 0, 1)` over 500ms. The steep start keeps a long duration feeling responsive. It only reads right on a full-width, edge-attached sheet.
- **A small floating drawer** (not touching the edge) gets about 200ms:
  ```css
  [vaul-drawer]  { transition: transform 0.2s cubic-bezier(0.165, 0.84, 0.44, 1); }
  [vaul-overlay] { transition: opacity  0.2s cubic-bezier(0.165, 0.84, 0.44, 1); }
  ```
- **One entity, one timing family.** Open, height change, and content crossfade share timing.
- Mark interactive children with `data-vaul-no-drag`.
- **Dismiss in the direction of entry.** A toast that slides up from the bottom swipes down to dismiss. A gesture on an axis the element never moved on has to be learned.

## Hold-to-confirm

Hold uses `linear` (it visualizes time, and time is linear); release before completion snaps back fast with `ease-out`. Symmetric timing is a bug.

```css
.hold-fill { clip-path: inset(0 100% 0 0); transition: clip-path 0.2s ease-out; }
.hold:active .hold-fill { clip-path: inset(0); transition: clip-path 1.5s linear; }
.hold { transition: transform 0.16s ease-out; }
.hold:active { transform: scale(0.97); }
```

The fill is a copy of the button content in a tinted overlay at `position: absolute; inset: 0`, revealed with `clip-path`. Never a `width` or `scaleX` bar: a bar behind the label can't recolor it. The transition on the state being entered is the one that runs, which is why each rule has its own.

## Reordering and dropping

- **On touch, a reorder without a handle starts on a hold:** ~250ms with ~5px tolerance. Distance-only means every scroll that starts on a row becomes a drag. A handle gets `touch-action: none` and drags at once.
- **Edge auto-scroll:** in the outer 20% of the scroll container, scroll faster the closer the pointer is to the edge.
- **Hovering a closed target ~800ms opens it** (expands a tree row, switches a tab).
- **Leave a gap where the item will land;** other items move out of the way on a spring.

## Touch surface CSS

```css
/* The sheet is a gesture surface; the browser shouldn't pan it. */
.sheet { touch-action: none; }
/* touch-action stops at the nearest scroll container, so the list still scrolls. */
.sheet .list { touch-action: pan-y; overscroll-behavior: contain; }
/* A horizontal carousel keeps vertical page scroll. */
.carousel { touch-action: pan-y; }
```

`touch-action` names what the browser keeps: `pan-y` for a horizontal drag, `pan-x` for a vertical one, `none` for both. When the list is at its top and the pull is downward, the sheet takes over by calling `preventDefault()` in a non-passive `touchmove` listener on the list: only there, only at the top, only while pulling down. Verify it on a real iPhone; hand-built sheets fail here most often.

## Testing gestures

- Test on a real phone via the dev server's local IP. Trackpad simulation lies about touch, and a 60Hz monitor hides roughness a 120Hz phone shows.
- Hit targets ≥ 44×44px via an invisible pseudo-element, not by growing layout. See [touch-accessibility.md](touch-accessibility.md).
- Gate hover effects behind `@media (hover: hover) and (pointer: fine)`.
- Under reduced motion, tracking stays (the user is producing it). The entrance, fly-off, and snap-back lose their movement: entrance and dismissal become an opacity fade in place, a cancelled drag returns with no spring.

---

## Scroll animation

The scrollbar belongs to the user. Motion may respond to scrolling; it must never take scrolling over or make content wait.

### Should this scroll animation exist?

```
Inside a product (dashboard, app, tool)?
├── Yes → no scroll animation. Content appearing late reads as lag.
└── No, a marketing surface (landing page, blog, docs):
    ├── In the initial viewport? → don't scroll-reveal it. One-time intro or nothing.
    ├── Revealing every section? → cut to 2–4 moments. If everything animates, nothing stands out.
    └── Does it explain, pace, or emphasize something specific?
        ├── Yes → build it.
        └── No  → no animation.
```

### Two kinds; don't confuse them

- **Triggered reveal:** crossing a threshold starts a normal animation with its own easing and duration.
- **Scrubbed:** scroll position is the clock. Progress maps directly to animation progress and reverses on scroll-up. No duration, no easing; adding a duration makes it lag behind the scrollbar.

### Triggered reveals

- **Reveal once.** Never re-animate on scroll-up or back-navigation. Unobserve after firing, or `once: true`.
- **Recipe:** `opacity: 0` + `translateY(10–16px)` → rest, strong ease-out, 400–600ms on marketing pages (200ms reveals look nervous there).
- **Trigger early,** at ~10–20% into the viewport, so it plays as the user arrives.
- **Stagger unevenly, by importance.** Siblings 80–120ms apart, heading first, least important item just fades. Never `delay={i * 0.1}`; pick delays by hand with unequal gaps (0, 120, 200, 300ms), even for equal cards.
- **Reveal images with `clip-path`** (`inset(0 0 100% 0)` → `inset(0)`), never `height`. Nothing shifts.
- **One entrance per container.** Reveal the section or stagger its children, not both.
- **Content is visible without JS.** The default CSS state is visible; JS adds the hidden state right before observing. A page of `opacity: 0` sections behind a failed script is the worst failure a marketing page has.

```js
const els = document.querySelectorAll("[data-reveal]");
els.forEach((el) => el.classList.add("reveal-pending")); // hidden only once JS runs

const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add("revealed");
    io.unobserve(e.target); // once
  }
}, { rootMargin: "0px 0px -10% 0px" });

els.forEach((el) => io.observe(el));
```

```css
.reveal-pending { opacity: 0; translate: 0 12px; }
.reveal-pending.revealed {
  opacity: 1; translate: 0 0;
  transition: opacity 500ms cubic-bezier(0.23, 1, 0.32, 1), translate 500ms cubic-bezier(0.23, 1, 0.32, 1);
}
@media (prefers-reduced-motion: reduce) {
  .reveal-pending { translate: none; }
}
```

With Motion already installed: `const inView = useInView(ref, { once: true, margin: "-100px" })`. Without it, use `IntersectionObserver`; Motion is too heavy to add for a threshold check. Never a scroll listener for this.

### Scrubbed animation

Preference order:

1. **CSS scroll-driven animations.** `animation-timeline: view()` (element's progress through the viewport) or `scroll()` (container progress). Off the main thread, stays attached to the scrollbar while the page is busy, no JS. Progressive-enhance behind `@supports`.
2. **Motion `useScroll` + `useTransform`** when progress must feed React logic or compose with springs. Runs on rAF on the main thread; can drop frames under load.
3. **A scroll listener writing React state:** never. A re-render per scrolled pixel.

```css
@supports (animation-timeline: view()) {
  .figure {
    animation: reveal linear both;
    animation-timeline: view();
    animation-range: entry 0% cover 40%;
  }
}
@keyframes reveal { from { opacity: 0; scale: 0.96; } }
```

```jsx
const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
const y = useTransform(scrollYProgress, [0, 1], [40, -40]);
<motion.div ref={ref} style={{ y }} />
```

`linear` is correct for scrubbed timelines: the user's hand provides the pacing, and a curve would distort the 1:1 mapping. A reading-progress bar is `scaleX` from `transform-origin: left` on `scroll()`, never `width`.

### Parallax

- Keep the differential ≤ ~15% of scroll distance between layers.
- Transform only, scrubbed, decorative elements only. Never body text.
- Disable entirely under `prefers-reduced-motion`. It's decorative and the classic vestibular trigger, so the reduced variant is none.
- Skip it on mobile; short viewports and momentum scrolling turn it into jitter.

### Sticky sections

A pinned section driven by scroll is an explanation device. Each increment must reveal a step. Progress maps monotonically (scrolling back rewinds). Keep pinned length ≤ 2–3 viewport heights. The user must be able to get through it by simply scrolling; never block or slow the scrollbar.

### Never hijack scroll

No scroll-jacking, no rewriting wheel deltas, no one-tick-one-slide. Smooth-scroll libraries that reimplement scrolling on the main thread trade native responsiveness for a float many users read as lag. Gate `scroll-behavior: smooth` behind `prefers-reduced-motion: no-preference` (snippet in [animation-performance-accessibility.md](animation-performance-accessibility.md)).

### Scroll performance and reduced motion

- Animate only `transform` and `opacity`; layout work stacks on top of the scroll itself.
- No `will-change` up front, scrubbed elements included. Add it to a specific element only after you see dropped frames.
- Animated `blur()` ≤ 20px.
- Under reduced motion: reveals keep the fade and drop the translate; parallax and floating decoration turn off; smooth scrolling turns off.

## Checklist

- Sheets use Vaul, toasts use Sonner, unless no library covers the gesture.
- Tracking is 1:1 via motion values or direct `transform` writes: no springs, no transitions, no React state, no parent CSS variables.
- Drag start checks primary button, gesture-owning children, selection, scroll state, and a 10px/2px threshold; axis locks once.
- Second pointers ignored; `pointercancel`, `lostpointercapture`, and Escape cancel without dismissing.
- Edges use a capped or rubber-band curve, not a hard stop or linear `dragElastic`.
- Release checks distance OR velocity, with a threshold measured the same way it was tuned.
- Release uses a velocity-seeded spring (`visualDuration`); snap-back ~300ms, no bounce; grabbable mid-animation.
- Clicks swallowed ~300ms after a drag; `touch-action` set on gesture surfaces; tested on a real phone.
- Scroll reveals exist only on marketing surfaces, fire once, skip above-the-fold content, and leave content visible without JS.
- Scrubbed motion uses CSS `animation-timeline` first, `useScroll` second, never a state-writing scroll listener.
- Parallax ≤ 15%, decorative only, off under reduced motion; no scroll hijacking.
