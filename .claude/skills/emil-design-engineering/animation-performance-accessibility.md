# Animation Performance, Reduced Motion, and Diagnosis

How to keep motion inside the frame budget, how to ship every animation as a reduced-motion variant too, and how to diagnose an animation that "feels off" by naming the cause before changing anything. Read it when an animation janks, when choosing which property to animate, when adding any motion (every animation needs its reduced variant), or when motion feels wrong and nobody can say why. Easing and duration values are in [animation-principles.md](animation-principles.md).

## The frame budget

60fps gives each frame **16.7ms**. On a 120Hz screen (most phones, many laptops) it's **8ms**. Design against the smaller one. A layout recalculation on a complex page can take 100ms or more: a dozen dropped frames, not one.

Two things decide whether you stay inside it:

1. **What you animate:** how much work each frame costs. Fully in your control.
2. **Where it runs:** whether the main thread can block it. Best-effort; the browser decides what it accelerates.

Never conclude "it's fine" from your own machine. A mid-range phone is the bar.

## What to animate: composite-only properties

The browser renders a change in three steps: **Layout** (size and position of everything), **Paint** (draw into layers), **Composite** (draw layers to the screen). Each property enters at one of them.

| Tier | Properties | Cost |
| --- | --- | --- |
| Composite only | `transform`, `opacity`; `filter`, `clip-path` in current Chrome/Firefox | Cheapest. Promoted to their own layer automatically. |
| Paint + composite | `box-shadow`, `border-radius`, `color`, `background-color` | Full redraw every frame. |
| Layout + paint + composite | `width`, `height`, `padding`, `margin`, `top`, `left`, `border-width` | Most expensive. Can move everything around the element. |

Animate `transform` and `opacity` by default. Test anything else across browsers and devices. Short color or background transitions on hover and press are fine; they skip layout and run on small elements.

| Instead of | Animate |
| --- | --- |
| `width` / `height` / `padding` to grow | `scale()` |
| `margin` / `top` / `left` to move | `translate()` (percentages are relative to the element) |
| `display` / `visibility` swaps | `opacity` |
| `box-shadow` | `filter: drop-shadow(...)`, or fade a pseudo-element's opacity |
| `border-radius` | `clip-path: inset(0 round 50px)` |
| `height` for an image reveal | `clip-path: inset(0 0 100% 0)` → `inset(0)` |

Layout properties also move the wrong things. A sidebar's `margin-left` shifts the text beside it every frame; `translateX` doesn't. An absolutely positioned element with few children might animate `padding` cheaply, but a `scale()` version looks the same and can't regress on a slower device. Choose that one.

### Never `transition: all`

It animates properties you didn't intend and hides layout and paint properties in plain sight. Name each property:

```css
/* Wrong */
.button { transition: all 200ms ease; }
/* Right */
.button { transition: background-color 150ms ease, transform 150ms ease-out; }
```

## Where it runs: keep it off the main thread

JavaScript always runs on the main thread. A `requestAnimationFrame` animation competes with everything else the page is doing, and when the thread is busy the frame is late.

| Driver | Thread |
| --- | --- |
| JS + rAF: GSAP, React Spring, Motion's `x`/`y`/`scale`/`rotate` shorthands (in many versions), `layout` animations, `useScroll` | Main thread, always |
| WAAPI: `element.animate()`, Motion's `opacity`, `filter`, `clipPath`, full `transform` string | Can be hardware-accelerated |
| CSS transitions, `@keyframes`, scroll-driven timelines | Can be hardware-accelerated |

Hardware acceleration means the animation runs on the compositor, smooth regardless of the main thread. Reliably accelerated: `transform`, `opacity`. Gaining support: `filter`, `clip-path`, `background-color`.

**The case that bites: motion that plays while the page does heavy work.** Page transitions, tab switches during navigation, animations alongside data loading or hydration. A tab highlight built with a Motion shared layout animation dropped frames because it played exactly while the next page loaded; moving it to CSS fixed it.

To keep a Motion animation accelerated, animate the transform as a string:

```jsx
<motion.div animate={{ x: 100 }} />                          // composed in JS per frame
<motion.div animate={{ transform: "translateX(100px)" }} />  // handed to WAAPI
```

- Use the shorthands by default; they're more readable. Switch to the string form when the animation must survive a busy main thread. Newer Motion versions accelerate more cases; check the installed version and profile before relying on shorthands under load.
- The string loses the WAAPI hand-off if you set `onUpdate`, `transformTemplate`, `repeatDelay`, `repeatType: "mirror"`, or `damping: 0`.
- Acceleration is a progressive enhancement. Browsers silently decline in some cases (Chrome historically didn't accelerate percentage transforms). Still use percentage translates for variable-size elements like toasts and drawers; correctness beats a best-effort optimization.

JS animation is not forbidden. It only hurts when heavy work runs during the animation. Use CSS for simple motion and anything that must stay smooth under load; use Motion for springs, layout, exits, and gestures.

## React re-render traps

Motion and React Spring animate outside React's render cycle. The trap is hand-rolled animation through state: a `setState` per frame re-renders per frame.

```jsx
// Wrong: a re-render every frame
setY(nextY);

// Right: no re-render
ref.current.style.transform = `translateY(${nextY}px)`;
// or a motion value: y.set(nextY)
```

Look for state updates inside rAF loops, `pointermove`, `scroll`, and drag handlers. With Motion, a `useState` for pointer position or hover opacity is the same bug; use motion values.

## Traps that pass both checks

### Inherited CSS variables

A `transform`-only, accelerated animation can still be slow if a CSS variable drives it. Variables inherit, so changing one on a parent recalculates styles for every descendant, every frame. A drawer's drag lagged with about 20 list items for exactly this reason:

```js
// Wrong: recalculates every child, every frame
el.style.setProperty("--swipe-amount", `${distance}px`);
// Right
el.style.transform = `translateY(${distance}px)`;
```

Suspect it whenever a `transform` animation gets slower as content grows. Animated CSS variables are never hardware-accelerated.

### Blur

`filter: blur()` gets expensive fast, worst in Safari. Keep animated blur ≤ 20px; 2–5px is enough to soften a crossfade. If a large blurred element must animate, promote it and keep the layer small.

## `will-change` and the 1px shift

An element can be handed between CPU and GPU mid-animation, which shifts it by about a pixel at the start or end. `will-change: transform` promotes it up front so no hand-off happens.

```css
.animated { will-change: transform; }
```

Add it only after you see the shift or dropped frames, and only on the element that animates. Browsers already promote elements animating `transform`/`opacity`, and every layer costs GPU memory. Never add it globally or as a first fix.

## Idle work

- **Pause loops off-screen** (spinners, shimmer, marquees, canvas):

```js
const io = new IntersectionObserver(([entry]) => {
  el.style.animationPlayState = entry.isIntersecting ? "running" : "paused";
});
io.observe(el);
```

- **Theme switches must not trigger transitions.** Disable them for the swap; the snippet is in [surfaces.md](surfaces.md#theme-switching).

## Diagnosing dropped frames

Work down this list in order:

1. **Which properties animate?** Anything besides `transform`/`opacity`. Layout tier first, then paint (`box-shadow`, `border-radius` don't look like layout). Check for `transition: all`.
2. **Does the jank coincide with the page being busy?** Navigation, fetching, hydration, a long task. Move the animation to CSS or WAAPI.
3. **Is React re-rendering per frame?** State updates in rAF or gesture handlers.
4. **Does it worsen as content grows?** Inherited CSS variable or too many animating nodes.
5. **Is a CSS variable animated at all?** `setProperty("--…")` or a `--var` in a style object inside a gesture or scroll handler.
6. **Any `blur()` above ~20px?** Especially Safari.
7. **Still shifting or stuttering?** Now add `will-change: transform` to that element.

Confirm a fix by recording the same interaction before and after in the DevTools Performance panel on a real mid-range phone over remote debugging, and check that the named cost shrank (dropped frames, Recalculate Style, Layout). CPU throttling on a desktop models a slow CPU, not a weak GPU or small memory budget.

---

## Reduced motion

Motion can make people sick (vestibular disorders are common) or pull attention from the task. Users set `prefers-reduced-motion: reduce` once at the OS level and expect every site to honor it.

### Gentler, not zero

`reduce` does not mean "no animation." Animation makes state changes understandable; deleting all of it makes the UI harder to follow. Remove the motion, keep the meaning.

| Under `reduce` | Do |
| --- | --- |
| Movement: `translate`, `scale`, `rotate`, position, layout, height, parallax | Remove |
| Meaning: `opacity`, `color`, `background-color` | Keep, ≤ 200ms |
| Autoplaying or looping animation, autoplay video, animated GIFs | Disable, or pause on a representative frame |
| Purely decorative motion (idle float, ambient loop) | Remove entirely |
| Explanatory visuals where motion carries the meaning | Jump between frames instead of tweening |
| Direct manipulation (an element tracking a drag) | Keep; the user produces it |

A modal that scales in becomes a modal that fades in. A sidebar sliding from `-100%` fades. A multi-step form that slides between steps crossfades.

### Workflow: two variants

1. Build the animation and get it right.
2. Write the `reduce` variant using the table above.
3. Turn on emulation (DevTools Rendering panel → Emulate CSS media feature `prefers-reduced-motion`) and watch it.

Done means every animation you touched has both variants and you have watched the reduced one. The common failure is a "reduced" variant that still moves because a `transform` was left in a shared class or a spring config.

### CSS

Swap the animation by name; don't delete it, don't use a blanket `* { animation: none }`, and don't use `!important`:

```css
@keyframes modal-in { from { opacity: 0; scale: 0.97; } }
@keyframes fade-in  { from { opacity: 0; } }

.modal { animation: modal-in 200ms ease-out; }

@media (prefers-reduced-motion: reduce) {
  .modal { animation-name: fade-in; }
  .drawer { transition-property: opacity; }
}
```

Put the hidden state in the keyframe's `from`, never in a base `opacity: 0` that only the animation clears. If the animation is removed or never runs, content must still be visible.

Tailwind: `motion-safe:` and `motion-reduce:` map to the two queries.

```html
<svg class="motion-safe:animate-bounce motion-reduce:animate-fade">…</svg>
```

### Motion: `useReducedMotion`

Branch values, or better, swap whole variant sets:

```jsx
const reduce = useReducedMotion();

<motion.div
  initial={{ opacity: 0, y: reduce ? 0 : 20 }}
  animate={{ opacity: 1, y: 0 }}
/>
```

For a component with several moving parts, call it once and audit every animating property. Movement usually hides in more than one place:

```jsx
const reduce = useReducedMotion();

<motion.div animate={reduce ? {} : { height: bounds.height }}>        {/* 1. height is movement */}
  <div ref={ref}>
    <AnimatePresence mode="popLayout" initial={false} custom={direction}>
      <motion.div
        key={step}
        variants={reduce ? fadeVariants : slideVariants}               // 2. slide → crossfade
        initial="initial" animate="active" exit="exit" custom={direction}
      />
    </AnimatePresence>
    <motion.div layout={!reduce} className="actions" />                {/* 3. layout is movement */}
  </div>
</motion.div>

const fadeVariants = { initial: { opacity: 0 }, active: { opacity: 1 }, exit: { opacity: 0 } };
```

### Motion: `MotionConfig` as the app-wide baseline

```jsx
<MotionConfig reducedMotion="user">{children}</MotionConfig>
```

The default is `"never"`, so nothing happens until you set it. With `"user"` it snaps `x`/`y`/`scale`/`rotate`, size/position properties, and `layout` animations to their end values and keeps `opacity` and `backgroundColor`. It cannot see CSS animations, a raw `transform` string in `animate`, or `useTransform`/`useSpring` values bound to `style`. Those need their own media query or `useReducedMotion` branch. Use `MotionConfig` as the baseline and `useReducedMotion` wherever the fade-only default loses meaning.

### Without Motion

```tsx
const QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion() {
  const [reduce, setReduce] = useState(false); // matches server render, syncs on mount
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    setReduce(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduce(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduce;
}
```

The first render is always `false`, so branch animation values only. Don't gate mounting on it, or reduced-motion users see a flash of the animated variant.

### Smooth scrolling

Opt in under `no-preference` so the accessible behavior is the default:

```css
@media (prefers-reduced-motion: no-preference) {
  html { scroll-behavior: smooth; }
}
```

The same applies to JS `scrollIntoView({ behavior: "smooth" })`: pass `"auto"` when reduced motion is on.

### Animated images

`<picture>` swaps in a static frame; the animated file is never downloaded:

```html
<picture>
  <source srcset="animated.avif" type="image/avif" media="(prefers-reduced-motion: no-preference)" />
  <source srcset="animated.gif" type="image/gif" media="(prefers-reduced-motion: no-preference)" />
  <img src="static.png" alt="…" />
</picture>
```

### Autoplaying video

Autoplay only under `no-preference`; otherwise stay paused with a visible play control.

```html
<video muted loop playsinline controls><source src="video.mp4" type="video/mp4" /></video>
<button type="button" hidden aria-live="polite">Play</button>
```

```js
const video = document.querySelector("video");
const btn = document.querySelector("button");
const noPref = window.matchMedia("(prefers-reduced-motion: no-preference)");

video.removeAttribute("controls");
btn.hidden = false; // shipped hidden so a dead control never flashes before JS runs
if (noPref.matches) { video.play(); btn.innerText = "Pause"; }

btn.addEventListener("click", () => {
  if (video.paused) { video.play(); btn.innerText = "Pause"; }
  else { video.pause(); btn.innerText = "Play"; }
});
```

### Looping animation: pause on a hero frame

A paused loop sits on frame 0, usually its least representative state. A negative `animation-delay` seeks into the timeline so it pauses on a frame you choose:

```css
.loop { animation: shake 0.2s infinite; }

@media (prefers-reduced-motion: reduce) {
  .loop {
    animation-play-state: paused;
    animation-delay: -0.4s; /* try values, keep the best-looking frame */
  }
}
```

---

## Diagnosing an animation that feels off

Turn "this feels off" into a named cause, then make the smallest fix. Never nudge values blindly; random tweaks produce a different animation, not a better one, and hide what actually helped.

### The loop

1. **Reproduce on the environment where it feels wrong.** A gesture fine on a laptop can stutter on a phone; a crossfade fine at 120Hz looks rough at 60Hz.
2. **Slow it down.** Set DevTools Animations panel playback to 10–25%, or screen-record and scrub frame by frame. A late fade, wrong origin, or two states reading as separate objects is invisible at full speed and obvious at quarter speed. Watch the first and last frame for a jump.
3. **Classify the symptom** with the tables below. Causes are listed in order of likelihood.
4. **Change one variable, re-record, compare.** Easing first, then duration. Duration depends on the curve (a steep curve affords a longer duration), so tuning duration first is wasted work.
5. **Verify at full speed, then again the next day.** An animation approved only in slow motion isn't approved, and flaws you're blind to tonight show up tomorrow.

When answering from code alone, say so, name the cause for each symptom, and give the order to apply the fixes. Report on-device checks as checks to run, not as verified.

### "Slow or sluggish"

| Check, in order | Fix |
| --- | --- |
| `ease-in` on an entrance or UI response | Strong ease-out. Same duration feels faster. |
| Built-in `ease-out` / `ease-in-out` keyword | Custom curve; the keywords accelerate too weakly. |
| Over ~300ms on product UI | Cut it. Only a very steep curve earns a long duration. |
| High-frequency or keyboard-triggered action | Remove the animation. |
| A `delay` in the chain | Remove or shrink it. |

### "Robotic, lifeless, flat"

| Check, in order | Fix |
| --- | --- |
| `linear` on non-constant motion | Ease-out for enter/exit, ease-in-out for on-screen movement. |
| Curve too weak | Steepen it. Flatness is usually the curve, not the duration. |
| Fixed-duration ease on something that should feel alive (drag release, morph) | Spring. If the spring feels weird, raise `damping`. |
| Uniform stagger | Vary delay and distance by importance. |

### "Cheap, but I can't say why"

| Check, in order | Fix |
| --- | --- |
| Enters from `scale(0)` or a bare fade | Start at `scale(0.95)` (0.97 for small elements) + opacity. |
| Wrong `transform-origin` | Scale anchored surfaces from the trigger (`--radix-*-transform-origin`, `--transform-origin`). Modals stay centered. |
| Sub-animations on different clocks | One timing family for the whole component. |
| Exit louder or longer than entrance | Exit in the entry direction, ~20–30% faster, smaller travel. |
| Motion doesn't fit the product's personality | Playful apps can bounce; dashboards stay crisp. Overrule the defaults only deliberately. |
| Crossfade still reads as two swapped objects after easing and duration are settled | Add `filter: blur(2px)` during the transition. Last resort, never first. |

### "Janky, drops frames"

| Check, in order | Fix |
| --- | --- |
| Animating layout properties | `transform` / `opacity`. |
| React state per frame | Motion values or direct style writes. |
| CSS variable on a parent drives child transforms | Write `transform` on the element. |
| Motion shorthands or `layout` while the page is busy | `transform` string, or CSS/WAAPI. |
| Animated `blur()` > 20px | Cap it. |

### "Jumps, snaps, shifts"

| Check, in order | Fix |
| --- | --- |
| Jumps when retriggered quickly (new toast, rapid toggle) | `@keyframes` restart from zero. Use a transition or spring. |
| Exit never plays | Missing `key`, or `AnimatePresence` inside the conditional. |
| Height snaps | `height: auto` isn't animatable. Measure and animate pixels. |
| 1px shift at start or end | `will-change: transform`. |
| Flashes the final state before animating | Initial state arrives after first paint. Set it in CSS, a keyframe `from`, or `@starting-style`. |
| Animates from the wrong place on mount | Resting element plays an entrance on page load. `initial={false}` or no entrance. |

### "Fires when it shouldn't, flickers"

| Check, in order | Fix |
| --- | --- |
| Hover oscillates | The transform moves the element out from under the cursor. Animate an inner child; the parent stays still. |
| Hover fires on phones | Gate with `@media (hover: hover) and (pointer: fine)`. |
| Every tooltip in a row animates | After the first opens, siblings open instantly: `[data-instant] { transition-duration: 0ms; }`. |
| Replays on every scroll into view or back-navigation | Run once; unobserve or persist a has-played flag. |
| Everything transitions on theme toggle | Disable transitions during the swap. |

### When no row matches

The animation may be built to spec and the spec is wrong. Re-derive in order: should it animate at all (frequency)? Right easing family for the motion type? Duration matched to that curve and the element's size? If a reference that feels right exists, record it and scrub both side by side.

## Checklist

- Only `transform` and `opacity` animate, or the exception was tested cross-browser; no `transition: all`.
- Animations that play during navigation, loading, or hydration run in CSS/WAAPI or use a Motion `transform` string.
- No React state updates per frame; no animated CSS variables on parents of many nodes.
- Animated blur ≤ 20px; `will-change` added only after an observed shift or jank, on that element only.
- Loops pause off-screen; theme switches disable transitions.
- Every animation has a reduced variant: movement removed, opacity/color kept, decoration and loops off.
- Reduced variant watched with DevTools emulation, not just reasoned about.
- `MotionConfig reducedMotion="user"` at the app root, plus `useReducedMotion` for CSS animations, `transform` strings, motion-value styles, height, and `layout`.
- Smooth scroll and autoplay are opt-in under `no-preference`; animated images have a static `<picture>` fallback.
- "Feels off" is diagnosed slowed down, one variable at a time, easing before duration, with the cause named before the fix.
