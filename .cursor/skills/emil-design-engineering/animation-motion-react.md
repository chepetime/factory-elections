# Motion for React

How to build and debug animations with Motion for React (`motion/react`, formerly Framer Motion), and how to pick the right animation tool or UI primitive in the first place. Read it before adding a dependency, before writing a `motion.*` component, and before diagnosing any Motion bug. Easing, duration, and when-to-animate rules live in [animation-principles.md](animation-principles.md); CSS-only recipes live in [animation-css.md](animation-css.md).

## Picking a tool

### Before recommending anything

1. **Read `package.json` first.** If something installed already covers the task, use it. Adding a second animation library or a second primitives library is a finding to flag, not a recommendation.
2. **Match the task, not the name the user said.** "Add a toast" gets a toast recommendation even if they mentioned Framer Motion.
3. **Recommend one thing.** Offer alternatives only when asked.
4. **Say when you're off the list below.** If no listed tool covers the task, state that before naming something else.

### What should this animation be written with?

| The animation | Use | Why |
| --- | --- | --- |
| User-triggered state change: hover, click, open/close | CSS transitions | Interruptible. Hover and unhover mid-flight and it retargets smoothly. |
| Re-triggered rapidly: stacking toasts, toggles, accordions, drawers | CSS transitions or a spring | `@keyframes` restart from zero. That is the bug where a second toast jumps to its new position. |
| Infinite loop: marquee, spinner, orbit | CSS `@keyframes`, `linear` | Nothing else needed. |
| Runs once on its own: page intro, text reveal, stagger | CSS `@keyframes` + `animation-fill-mode` | Delay with `calc(var(--i) * var(--stagger))`. No JS. |
| Simple enter/exit that won't be interrupted | CSS keyframes or `@starting-style` | `@starting-style` gives an enter transition with no `mounted` state or `useEffect`. |
| Must stay smooth while the main thread is busy (page loads, navigation) | CSS or WAAPI on `transform`/`opacity` | Can run off the main thread. Swapping one JS library for another does not fix main-thread jank. |
| Programmatic but hardware-accelerated, colocated with JS logic | WAAPI (`element.animate()`) | Keeps logic in one place without a rAF loop. |
| Real springs, momentum, interruptions that keep velocity | Motion | CSS `linear()` only approximates a spring. |
| Exit of a component React removed, inside a Radix primitive | CSS keyframes on `[data-state="closed"]` | Radix delays unmount until the animation ends. |
| Exit of a component React removed, anywhere else | Motion `AnimatePresence` | The element is gone; CSS has nothing left to animate. |
| One element morphing into another, layout changes, `flex-direction` | Motion `layout` / `layoutId` | CSS can't interpolate layout. |
| Drag, drag-to-dismiss, momentum | Motion `drag`, or Vaul for sheets | See [animation-gestures-scroll.md](animation-gestures-scroll.md). |
| Scroll-triggered reveal | `IntersectionObserver`, or `useInView` if Motion is already installed | Don't add a library to detect viewport entry. |
| Theme toggle wipe, page-to-page morph | View Transitions API | Duplicating the page for a `clip-path` wipe is a hack. |

Rule of thumb: CSS for simple and hardware-accelerated motion, Motion for complex and physical motion. Using both in one project is normal. Users don't care whether it was CSS; if the right result needs a library, use the library. Frame drops come from animating the wrong properties, rarely from bundle size.

### Animation libraries

- **Motion for React.** Springs, layout and shared-layout animation, exit animations, gestures, very little code. Against: bundle size, and a lot of magic that is hard to debug when it misfires. Import from `motion/react`; outside React use vanilla `motion`. In a size-sensitive surface (docs, marketing pages that don't already ship it) prefer CSS; in an app that already ships it, use it freely.
- **React Spring.** Spring-based, smaller than Motion, very configurable, pairs with `use-gesture`. Against: steep learning curve, more code for the same result. Pick it when spring control matters more than development speed.
- **GSAP.** Framework-agnostic, excellent timelines, easy to learn, free. Against: no real springs, not React-native (there is `useGSAP`). Pick it for timeline-heavy marketing work, not product UI that needs springs.
- Don't recommend Anime.js or Popmotion.

### Don't build these yourself

Accessible dropdowns, selects, toasts, and navigation menus need correct keyboard navigation, focus management, and ARIA. Use unstyled primitives and style them yourself.

| Task | Use |
| --- | --- |
| Dropdown, navigation menu, dialog, tooltip, tabs, select, popover | Radix Primitives (or Base UI, or React Aria) |
| Toast / notifications | Sonner |
| Drawer / bottom sheet | Vaul |

- **Radix** is the default: mature, widely used, and animation-friendly. It exposes origin-aware `--radix-*-transform-origin` variables, `data-state` for exit animations, and `data-motion` for direction-aware navigation-menu content.
- **Base UI** has a near-identical shape (swap with a few CSS variables and data attributes), exposes `--transform-origin`, `data-starting-style`/`data-ending-style`, and `data-instant` to kill the animation on subsequent tooltips. Recommend it when it's installed or asked for. Being newer is not a reason to switch, and an unmaintained library doesn't stop working.

### Utilities

| Need | Use |
| --- | --- |
| Measure content to animate height | `react-use-measure` (a `ResizeObserver` wrapper; easy to hand-roll) |
| Dismiss on outside click | `useOnClickOutside` from `usehooks-ts` |
| Conditional class names | `clsx` |

### Deciding on a dependency

- Weigh what it saves. A mature navigation menu took weeks; an afternoon rewrite won't match it.
- Bundle size is a trade-off, not a veto. Make it explicitly (Vaul ships without a spring library and gives up the small iOS snap-point bounce for size).
- Don't adopt something because it's new and popular. Ask what problem it solves here.

**Flag on sight:** a hand-rolled toast, drawer, dropdown, select, or tooltip with manual focus handling; Motion pulled in for a plain hover or fade; a second animation library next to an installed one; `@keyframes` on anything that can be re-triggered mid-play; a heavy library imported only for viewport detection.

## Basics

```jsx
import { motion, AnimatePresence } from "motion/react"; // was "framer-motion"; same API

<motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} />
```

`initial` is the start state, `animate` the end state. Values interpolate outside React's render cycle, so an animating component does not re-render. Prefer the declarative API (`initial`/`animate`/`exit`/`variants`) everywhere.

## Transitions and springs

Without a `transition`, Motion picks per value: physical values (`x`, `scale`) get a spring, others (`opacity`, `color`) get a tween.

```jsx
transition={{ duration: 0.3, ease: "easeOut" }}                          // tween
transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}                // tween, custom curve
transition={{ type: "spring", duration: 0.3, bounce: 0 }}                // state swaps, no overshoot
transition={{ type: "spring", duration: 0.5, bounce: 0.2 }}              // slight, lively overshoot
transition={{ type: "spring", visualDuration: 0.5, bounce: 0 }}          // gesture release
transition={{ type: "spring", stiffness: 100, damping: 10, mass: 0.75 }} // physics form
```

- **Prefer `duration` + `bounce`** over stiffness/damping/mass. It's readable and tunable.
- **Use `visualDuration` for anything gesture-driven.** A `duration` spring starts from rest and ignores the release velocity; `visualDuration` keeps it.
- **Bounce defaults to 0.** Add it deliberately (drag release, playful UI), keep it at 0.1 to 0.3. Smaller elements need more bounce to read the same.
- **A spring that looks jittery or wild: raise `damping`.** That fixes it most of the time.
- **Lower `mass` tracks an input more tightly.** A cursor follower wants `mass: 0.1`.
- Pull repeated spring configs into a named constant.

### MotionConfig

When two or more motion elements in a component move together, set the shared transition once on `MotionConfig` instead of passing the same object to each element. The component then reads as one object and is tuned from one place.

```jsx
<MotionConfig transition={{ type: "spring", duration: 0.5, bounce: 0 }}>…</MotionConfig>
```

Override library defaults so every part of a component shares one timing family. A drawer that opens in 200ms with a 500ms height change feels broken.

## AnimatePresence

```jsx
<AnimatePresence mode="popLayout" initial={false} custom={direction}>
  <motion.span
    key={state}          // required
    custom={direction}   // pass again, or the exiting element reads stale props
    initial={{ opacity: 0, y: -25 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: 25 }}
    transition={{ type: "spring", duration: 0.3, bounce: 0 }}
  />
</AnimatePresence>
```

- **`AnimatePresence` wraps the conditional, never sits inside it.** `{open && <motion.div exit={…} />}` with no presence ancestor has a silently dead `exit`.
- **A `key` is mandatory** on the direct child. Without it the element never unmounts and the exit never fires. Check the key first whenever an exit doesn't play.
- **`mode="sync"`** (default): enter and exit run together, both in flow. Fine for overlays.
- **`mode="wait"`**: the old element leaves completely before the new one enters. Use it for rich state-to-state morphs and swaps where the two states must never overlap.
- **`mode="popLayout"`**: the exiting element is popped out of flow so siblings reflow while it leaves. Use it for state swaps inside a button, step transitions, crossfades, and any exiting item in a group (list items, toasts, tags). If an exit looks broken, try changing `mode` before anything else.
- **`initial={false}`** skips the mount animation, so toggles, tabs, icon swaps, and segmented controls don't animate on first paint. Don't use it on a real first-run entrance (staggered hero), where it skips the whole thing. After adding it, hard-refresh and confirm nothing that should animate went static.
- **Exiting elements have stale props.** They're already removed from the tree. Pass `custom` to both `AnimatePresence` and the child to feed them current data.
- Use separate `AnimatePresence` blocks for things that should exit on different clocks (an overlay that leaves fast and a card that morphs back).

## Variants and direction-aware slides

Variants are named target sets. The function form receives `custom`, which is what makes direction-aware motion work:

```jsx
const variants = {
  initial: (direction) => ({ x: `${110 * direction}%`, opacity: 0 }),
  active:  { x: "0%", opacity: 1 },
  exit:    (direction) => ({ x: `${-110 * direction}%`, opacity: 0 }),
};

<motion.div variants={variants} initial="initial" animate="active" exit="exit" custom={direction} />
```

- Store direction in state and set it in the same handler that changes the step: `setDirection(1)` on next, `-1` on back.
- `110%` instead of `100%` clears the container completely.
- Variants propagate to children. Stagger with `staggerChildren` on the parent:

```jsx
const list  = { show: { transition: { staggerChildren: 0.1 } } };
const piece = {
  hide: { opacity: 0, y: 8, filter: "blur(2px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)" },
};

<motion.section variants={list} initial="hide" animate="show">
  {items.map((i) => <motion.div key={i.id} variants={piece}>{i.content}</motion.div>)}
</motion.section>
```

## Layout and shared-element animations

- **`layout`** animates any layout change: position, size, `flex-direction`, `justify-content`. Change the element's real styles (className, inline style, DOM position). Motion measures before and after and animates the difference with transforms. Don't put the target in `animate`.
- **Add `layout` to neighbours too**, or they jump while the animating element glides.
- **`layoutId`** links two different elements. When one mounts with the same `layoutId` as one that just unmounted, Motion morphs between them. Tab indicators, card to detail view, button to popover, items flying into a bin.
- **You can't steer a shared layout animation.** To add motion on top, animate the parent and let the children ride along: `<motion.div animate={{ y: 73 }} transition={{ delay: 0.13 }}>`.
- **Set animated `border-radius` (and `box-shadow`) inline, in pixels.** Layout animations scale the element, which distorts corners. Motion corrects the distortion only for inline pixel values, not for a class or `rem` value.

```jsx
// Wrong: rounded-xl from a class distorts mid-morph
<motion.div layoutId="card" className="rounded-xl" />
// Right
<motion.div layoutId="card" style={{ borderRadius: 12 }} />
```

- For full control of a morph between a finite set of states, animate `layout` between fixed width/height values per state instead of content-driven sizes.
- Layout animations run on the main thread. If one drops frames during page loads (a tab highlight during navigation), move it to CSS. See [animation-performance-accessibility.md](animation-performance-accessibility.md).

## Animating height to auto

Motion can animate a fixed height to `auto`, but not `auto` to `auto`, which is what changing content needs. Measure it:

```jsx
import useMeasure from "react-use-measure";

const [ref, bounds] = useMeasure();

<motion.div animate={{ height: bounds.height ? bounds.height : null }} style={{ overflow: "hidden" }}>
  <div ref={ref} className="p-6">{content}</div>
</motion.div>
```

- **The `ref` and `animate={{ height }}` go on different elements.** On the same one, the height sticks and stops reacting to content.
- **Padding lives on the inner, measured element** so the measurement includes it.
- **`bounds.height` is 0 on first render.** Falling back to `null` means `auto` and avoids a layout shift.
- **Anything below the changing content stays inside the measured element** as a `motion` element with `layout` (a footer, an action row), so it rides the same transition instead of jumping.

## Motion values

Motion values update outside React, so a value can change every frame with zero re-renders. Use them for anything high-frequency, pointer tracking above all. Convert everything the pointer drives, including enter/leave fades: `opacity.set(1)` in `onPointerEnter`, not a `useState` boolean.

```jsx
const x = useMotionValue(0);   // .set() / .get()
<motion.div style={{ x }} />   // x/y map to translateX/translateY
```

| Hook | Use it for |
| --- | --- |
| `useMotionValue` | Values that must track an input 1:1: a dragged element, drag-to-dismiss scale, a chart crosshair. A spring here feels disconnected from the finger. |
| `useSpring` | Things that react to the pointer rather than being moved by it: followers, tilts, glows, a graph drawing toward the cursor. A raw value feels lifeless. |
| `useTransform` | Map one value's range onto another: `useTransform(y, [0, 300], [1, 1.5])`. The function form transforms output, e.g. a displayed number. |
| `useMotionTemplate` | Build a reactive string (`clipPath`, `filter`, gradients). A motion value inside a plain template literal never updates. |

```jsx
const label = useTransform(angle, (v) => `${Math.round(v)}°`);
const clip  = useMotionTemplate`inset(0px ${clipValue}% 0px 0px)`;
```

## Gestures, scroll, reduced motion, performance

- `drag`, `dragConstraints`, `dragMomentum`, `dragElastic`, `onDragEnd` thresholds, and `useScroll`/`useInView` are covered in [animation-gestures-scroll.md](animation-gestures-scroll.md).
- `whileTap={{ scale: 0.97 }}` is the press feedback; never below `0.95`.
- `useReducedMotion` and `<MotionConfig reducedMotion="user">` are covered in [animation-performance-accessibility.md](animation-performance-accessibility.md), along with when `x`/`y` versus a `transform` string run on the main thread.

## Imperative animation

`useAnimate()` returns `[scope, animate]` for selector-based, sequenced control. It is more powerful and much harder to maintain. Stay declarative unless you're orchestrating many elements across events. When you do use it: target `[data-animate]` selectors inside the scope, use `times: [0, 0.4]` to place keyframes within the duration, return `Promise.all(...)` so callers can await, and stop an in-flight animation before restarting it.

## Recipes

### Button state swap (idle → loading → success)

```jsx
const copy = { idle: "Send me a login link", loading: <Spinner size={16} />, success: "Login link sent!" };

<button disabled={state === "loading"}>
  <AnimatePresence mode="popLayout" initial={false}>
    <motion.span
      key={state}
      initial={{ opacity: 0, y: -25 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 25 }}
      transition={{ type: "spring", duration: 0.3, bounce: 0 }}
    >
      {copy[state]}
    </motion.span>
  </AnimatePresence>
</button>
```

Enter from above, exit below: one continuous downward motion, like a reel. Lift it into a reusable `<AnimatedState>` wrapper.

### Icon swap (copy → check, play → pause)

Deep scale, fade, a little blur, bounce-free spring:

```jsx
<AnimatePresence mode="popLayout" initial={false}>
  <motion.span
    key={copied ? "check" : "copy"}
    initial={{ scale: 0.3, opacity: 0, filter: "blur(3px)" }}
    animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
    exit={{ scale: 0.3, opacity: 0, filter: "blur(3px)" }}
    transition={{ type: "spring", duration: 0.35, bounce: 0 }}
  >
    {copied ? <CheckIcon /> : <CopyIcon />}
  </motion.span>
</AnimatePresence>
```

A timid scale (0.8, 0.9) reads as a glitch; 0.3 reads as a swap. Use `mode="wait"` instead when the new icon must not appear until the old one is gone. Good for hover-revealed actions, toggles, loading → success; not for permanent navigation icons.

### Multi-step flow with auto height

```jsx
const [step, setStep] = useState(0);
const [direction, setDirection] = useState(1);
const [ref, bounds] = useMeasure();

<MotionConfig transition={{ type: "spring", duration: 0.5, bounce: 0 }}>
  <motion.div animate={{ height: bounds.height }} style={{ overflow: "hidden" }}>
    <div ref={ref} className="p-6">
      <AnimatePresence mode="popLayout" initial={false} custom={direction}>
        <motion.div key={step} variants={variants} initial="initial" animate="active" exit="exit" custom={direction}>
          {content}
        </motion.div>
      </AnimatePresence>
      <motion.div layout className="actions">
        <button onClick={() => { setDirection(-1); setStep((s) => s - 1); }}>Back</button>
        <button onClick={() => { setDirection(1); setStep((s) => s + 1); }}>Continue</button>
      </motion.div>
    </div>
  </motion.div>
</MotionConfig>
```

`variants` is the direction-aware set above. Four things carry it: `custom` on both, `layout` on the buttons, measured height instead of magic numbers, and one `MotionConfig`.

### Drawer with crossfading views and auto height

Outer element animates `height: bounds.height`; views swap inside `AnimatePresence mode="popLayout"` with `opacity` and `scale: 0.96 → 1`. Height easing `[0.25, 1, 0.5, 1]` over about `0.27s`. If the drawer is Vaul, override its 500ms open to 200ms so open, height, and crossfade share timing. Scale the crossfade duration to how much the height changed so short-to-short swaps don't over-fade:

```js
const MIN = 0.15, MAX = 0.27;
const delta = Math.abs(bounds.height - previousHeightRef.current);
const duration = Math.min(Math.max(delta / 500, MIN), MAX); // useMemo on [bounds.height]
```

### Button morphs into a popover

```jsx
<motion.button layoutId="wrapper" style={{ borderRadius: 8 }}>
  <motion.span layoutId="title">Feedback</motion.span>
</motion.button>

<AnimatePresence>
  {open ? (
    <motion.div layoutId="wrapper" style={{ borderRadius: 12 }}>
      <motion.span layoutId="title" aria-hidden className="placeholder">Feedback</motion.span>
      <textarea placeholder="Feedback" className="placeholder:opacity-0" />
    </motion.div>
  ) : null}
</AnimatePresence>
```

The grey text in the popover is a separate span sharing `layoutId="title"` with the button label, so the label appears to become the placeholder. Keep the real `placeholder` for screen readers (hidden visually) and `aria-hidden` the fake one. Swap form → success inside a nested `AnimatePresence mode="popLayout"` with `y`, `opacity`, and `filter: blur(4px)`, spring `duration: 0.4, bounce: 0`. Wire `Escape` to close and `Cmd/Ctrl+Enter` to submit.

### Shared element: card → detail

- Every corresponding pair gets a matching `layoutId`: `card-${id}`, `image-${id}`, `title-${id}`, `description-${id}`.
- The open card uses `position: fixed; inset: 0` as a real style change.
- Separate `AnimatePresence` for overlay and card; the overlay exits fast: `exit={{ opacity: 0, transition: { duration: 0.05 } }}`.
- Content that exists only in the open state gets `layout` plus its own fade with a very short exit, so it doesn't linger while the card shrinks.
- Inline pixel `borderRadius` on every morphing element, images included. Close on outside click and `Escape`.

### Tab highlight

```jsx
{activeTab === tab ? (
  <motion.div layoutId="tab-indicator" className="absolute inset-0 rounded-lg bg-black/5" />
) : null}
```

Render it only for the active tab; the remount under the same `layoutId` slides it. Drive it from `onMouseOver` and `onFocus` so keyboard focus moves it too. It must sit still on first render; an indicator that slides in from 0,0 on page load is a bug. If it janks during navigation, rebuild it in CSS.

### Items flying into a bin

- Grid items and bin items are different elements sharing a per-item `layoutId` (`` `image-${id}` ``). Rotate stacked items by index for a scattered look.
- Fake the drop by animating the bin's parent (`animate={{ y: 73 }}`, delayed).
- Unselected items get a fast exit: `exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.05 } }}`.
- Fix z-order with timing: fade the bin's front panel in with `duration: 0, delay: 0.175` as the items arrive.
- One `MotionConfig` (`{ type: "spring", duration: 0.5, bounce: 0.2 }`) for the whole interaction.

### Cursor follower

```jsx
const SPRING = { mass: 0.1 };
const x = useSpring(0, SPRING);
const y = useSpring(0, SPRING);
const opacity = useSpring(0);

<div
  onPointerMove={(e) => {
    const r = e.currentTarget.getBoundingClientRect();
    x.set(e.clientX - r.left - 24); // 24 = half the follower, to centre it
    y.set(e.clientY - r.top - 24);
  }}
  onPointerEnter={() => opacity.set(1)}
  onPointerLeave={() => opacity.set(0)}
>
  <motion.div style={{ x, y, opacity }} />
</div>
```

No state, no re-renders. The default mass lags too far behind.

### Graph that draws toward the cursor

```jsx
const clip = useSpring(0, { damping: 18 });
const clipPath = useMotionTemplate`inset(0px ${clip}% 0px 0px)`;

function onPointerMove(e) {
  const r = e.currentTarget.getBoundingClientRect();
  clip.set(Math.min((Math.max(r.right - e.clientX, 0) / r.width) * 100, 100));
}

<motion.svg style={{ clipPath }} />
```

It's unclipping, not drawing. On pointer leave, reset to 0 after a 1s timeout (store the id in a ref, clear it on re-enter), and use a softer spring for the reset than for tracking. A component's resting state should be its best-looking state.

### Dynamic Island-style morph

Springs with bounce, set per transition because smaller states need more (`idle: 0.5`, `ring: 0.35`, `timer: 0.3`). Animate `layout` between fixed sizes, inline pixel radius, `mode="wait"` between rich states, slight blur on enter/exit, `tabular-nums` for changing digits. Pass per-transition `scale`/`y`/`bounce` through `custom`. Hardcoding a finite set of transitions is fine.

## Common bugs

| Symptom | Cause and fix |
| --- | --- |
| Exit animation doesn't play | Missing `key`, or `AnimatePresence` is inside the conditional. Then try a different `mode`. |
| Direction-aware slide always goes the same way | Exiting element has stale props. Pass `custom` to `AnimatePresence` and the child. |
| Border radius warps during a morph | Radius from a class or `rem`. Move it to inline `style={{ borderRadius: 12 }}`. |
| Height freezes or jumps | `ref` and `animate={{ height }}` on the same element, or no `null` fallback for the first-render 0. |
| Neighbours jump during a layout animation | They need `layout` too. |
| Footer jumps when content height changes | It's outside the measured element. Move it inside with `layout`. |
| Animated string never updates | Motion value in a plain template literal. Use `useMotionTemplate`. |
| Spring jittery or wild | Raise `damping`. |
| Fling ignores release speed | Spring uses `duration`. Use `visualDuration`. |
| Animates on first paint | Add `initial={false}` to `AnimatePresence`. |
| Both elements visible when switching fast | Known `AnimatePresence` race. Try `mode="popLayout"` or `"wait"`; versions before 11.0.10 predate it. |
| Component re-renders every pointer move | State used for pointer position. Use motion values. |

## Checklist

- Checked `package.json`; no second animation or primitives library added.
- Motion is used only for what CSS can't do: springs, layout, `layoutId`, exits of unmounted components, gestures.
- Every `AnimatePresence` child has a `key`, and `AnimatePresence` wraps the conditional.
- `mode` chosen deliberately: `popLayout` for in-place swaps and grouped exits, `wait` for non-overlapping states.
- `initial={false}` on toggles, tabs, and icon swaps; not on first-run entrances.
- `custom` passed to both `AnimatePresence` and the child for direction-aware motion.
- Morphing elements have inline pixel `borderRadius`; siblings that move have `layout`.
- Auto height uses `useMeasure` with ref and animated height on separate elements.
- Pointer-driven values use motion values, never React state; `useMotionTemplate` for strings.
- Shared timing lives on one `MotionConfig`; gesture springs use `visualDuration`; bounce is 0 unless the motion is physical.
