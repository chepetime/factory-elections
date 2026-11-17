# Animation Principles

The decision layer for UI motion: whether something should animate, which easing and duration to use, when to reach for a spring, and the exact recipes for common components (modals, popovers, dropdowns, tooltips, toasts, drawers, buttons). Read this before writing any animation code. For CSS implementation see [animation-css.md](animation-css.md); for Motion/React see [animation-motion-react.md](animation-motion-react.md); for drag, swipe and scroll see [animation-gestures-scroll.md](animation-gestures-scroll.md); for frame budget and reduced motion see [animation-performance-accessibility.md](animation-performance-accessibility.md).

## What "right" means

An animation feels right when it is natural (it mirrors real physics: nothing moves at constant speed or appears from nothing), purposeful (you can say why it animates in one sentence), and unnoticed (the user finishes their task instead of admiring the transition). Default to less. A fast, well-eased 200ms transition beats an elaborate 500ms sequence. When in doubt, don't animate.

**If everything animates, nothing stands out.** Motion is a spice. Every animation you add lowers the value of the others, so pace it through the experience and spend it where it carries information.

**Match the project's stack.** Before writing animation code, check what the project already uses: plain CSS, Tailwind, Motion (`motion` or `framer-motion` in package.json), React Spring, WAAPI. Write in that system and extend its existing easing and duration tokens rather than inventing a parallel set. Never add a library for something a CSS transition can do, and never hand-roll spring physics when Motion is installed.

## Should this animate at all?

### Frequency decides first

| How often one user sees it | Decision |
| --- | --- |
| 100+ times/day (command palette toggle, keyboard shortcuts, arrow-key list navigation) | No animation. Ever. |
| Tens of times/day (hover on list rows, sidebar items, tab switches in a power tool) | Remove, or make instant |
| Occasional (modals, dropdowns, drawers, toasts) | Standard animation, under 300ms |
| Rare or first-time (onboarding, empty state, success celebration) | Can be more elaborate; this is the only place delight lives |

Raycast has no open/close animation on its menu, and that is the correct experience for something opened hundreds of times a day. A hover that looks lovely in a demo becomes friction at 50 uses a day, even at 200ms. Judge every animation as a daily driver, not as a demo.

Press feedback (`scale(0.97)` on `:active`) is the exception: it passes on any button however often it's clicked, because it makes the interface respond sooner. High-frequency dense controls may still skip it.

### Never animate keyboard-initiated actions

Arrow-key navigation, shortcuts, focus movement, and keyboard-opened menus get no animation. Keyboard users move fast, and motion makes the UI feel disconnected from their input. A selection highlight that follows the cursor or arrow keys must be instant; a smooth fade trails one step behind.

### It needs a purpose

Every animation answers "this animates so that..." with one of:

- **Feedback**: the interface registered the press or click.
- **Spatial consistency**: it shows where something came from and where it went.
- **State indication**: a state changed and the user should notice.
- **Preventing a jarring change**: a toast eases in instead of popping.
- **Explanation**: mostly marketing and onboarding.
- **Delight**: only on things seen rarely, so it stays a surprise instead of becoming a daily annoyance.

"It looks cool" on a frequently-seen element is not a purpose. If you can't finish the sentence, cut it.

### Function over decoration

Motion that sits between the user and their goal fails, however pretty. Staggering dropdown items looks good once and slows every use after; users interact measurably faster with no item animation. Animating a chart in a product is pointless; the same chart on a marketing page can be an easter egg. Data-dense and information-critical UI defaults to static.

### Marketing vs. product

Marketing pages are viewed less often and are mostly non-interactive, so they can run longer, carry one-shot intros, and hide easter eggs. Product UI must feel fast, and its motion stays functional.

### Personality

Match motion to the product. Vercel's product motion is deliberately very fast or absent because the brand is about speed. Sonner uses `ease` and slightly longer durations because it should feel elegant. A playful consumer app can bounce; a dashboard stays crisp.

### Respect decisions already made

If a comment or design doc says motion was deliberately left out, or a bounce was chosen for brand reasons, that is an answer. Removing an animation the user chose is a decision to raise with them, not a silent fix.

## Easing

Easing matters more than any other parameter. It can make a weak animation look great or a good one feel wrong.

### Which curve

```
Entering or exiting the screen (modal, dropdown, toast, tooltip)?  → ease-out
Already on screen, moving or resizing (reorder, slider, morph)?    → ease-in-out
Hover, color, background, shadow, opacity change?                  → ease, ~150ms
Constant motion or time made visible (marquee, spinner, hold)?     → linear
Unsure?                                                            → ease-out
```

- **ease-out** starts fast, which reads as an instant response to the user's action. The element jumps toward its destination, then settles.
- **ease-in-out** accelerates then brakes, like a car. Use it for things already on screen. Don't use a symmetric ease-in-out on something the user just tapped: the slow start reads as lag.
- **ease** is asymmetric (faster start, slow end) and is the one built-in worth using as-is, for hover and color changes.
- **linear** is only for constant-rate motion: marquees, tickers, orbits, constant rotation, and progress that represents time (a hold-to-delete fill is linear because it is time). Everywhere else linear looks robotic.
- **ease-in: never on UI.** It starts slow, delaying the exact moment the user is watching for a response, then accelerates into the stop, the opposite of how objects settle. The same duration feels slower. The only tolerated use is a subtle exit of 150ms or less paired with an ease-out entrance. Never on an entrance, hover, or press.

### Use custom curves

Built-in keywords (`ease-out`, `ease-in-out`) are too weak; their acceleration is so mild that motion feels flat. Treat the keywords as categories and pick a real cubic-bezier. Prefer asymmetric curves with a steep start and slow settle: they feel alive and mimic a spring without one. When an animation feels flat, the curve is too weak before the duration is wrong.

Curves sorted weak to strong:

```css
/* ease-out: enters, exits, user-initiated UI */
--ease-out-quad:  cubic-bezier(0.25, 0.46, 0.45, 0.94);  /* button press */
--ease-out-cubic: cubic-bezier(0.215, 0.61, 0.355, 1);
--ease-out-quart: cubic-bezier(0.165, 0.84, 0.44, 1);
--ease-out-quint: cubic-bezier(0.23, 1, 0.32, 1);        /* strong default for dropdowns */
--ease-out-expo:  cubic-bezier(0.19, 1, 0.22, 1);        /* reveals, card hovers, text reveal */
--ease-out-circ:  cubic-bezier(0.075, 0.82, 0.165, 1);

/* ease-in-out: elements moving or morphing on screen */
--ease-in-out-quad:  cubic-bezier(0.455, 0.03, 0.515, 0.955);
--ease-in-out-cubic: cubic-bezier(0.645, 0.045, 0.355, 1);  /* on-screen back-and-forth */
--ease-in-out-quart: cubic-bezier(0.77, 0, 0.175, 1);
--ease-in-out-quint: cubic-bezier(0.86, 0, 0.07, 1);
--ease-in-out-expo:  cubic-bezier(1, 0, 0, 1);
--ease-in-out-circ:  cubic-bezier(0.785, 0.135, 0.15, 0.86);

/* named curves */
--ease-sheet:         cubic-bezier(0.32, 0.72, 0, 1);  /* iOS-style sheet (Vaul); extremely steep start; good default for enters */
--ease-drawer-height: cubic-bezier(0.25, 1, 0.5, 1);   /* snappy height change */
```

Start around cubic/quart and adjust by eye. Use the project's tokens when they exist.

## Duration

| Element | Duration |
| --- | --- |
| Button press | ~150ms |
| Hover, color, shadow changes | 100–150ms (300ms feels swimmy) |
| Tooltip, small popover | 125–200ms |
| Dropdown, select, popover | 150–250ms |
| Modal | 200–300ms |
| Drawer, sheet, toast | 200–300ms; a full-height sheet up to 500ms only on a curve as steep as `--ease-sheet` |
| Page-level transition | 300–400ms |
| Large element crossing the screen | up to ~1s |
| Marketing | Freer |

Rules:

- **Product UI stays under 300ms** unless size, travel distance, or a very steep curve justifies more. If it feels slow, it is slow: cut duration first. A 180ms dropdown feels more responsive than a 400ms one.
- **Choose the easing first, then tune duration to it.** They are one decision. A steep curve front-loads the movement, so it can afford longer: Vaul's 500ms on `cubic-bezier(0.32, 0.72, 0, 1)` doesn't feel slow, and shortening it feels too fast. The same 500ms on `ease` is sluggish. A weak curve must be shorter.
- **Bigger elements and longer travel get more time.** A truck stops slower than a bicycle; a full-screen sheet needs more than a tooltip.
- **Exits run 20–30% faster than enters** (enter 250ms, exit 180ms). The user has already decided to leave.
- **Too fast is as bad as too slow.** Below the point where the eye can track the motion, it reads as a glitch.
- **Perceived speed counts.** A faster spinner makes the same load feel faster. A snappy dropdown makes the whole app feel faster.
- **Adaptive duration** for size-dependent transitions (an auto-height panel): scale duration with how much changed, clamped, so small changes don't over-animate. `duration = clamp(delta / 500, 0.15, 0.27)` seconds.

## Springs

Springs simulate physics and have no fixed duration. Use them for:

- Drag with momentum (sheets, swipe-to-dismiss, sliders).
- Gestures the user can interrupt or reverse mid-flight.
- Elements meant to feel alive (Dynamic Island-style morphs), cursor-following.
- Icon and text swaps where a bounce-free spring feels crisper than a tween.

Simple color and opacity changes don't need a spring. Real springs are impossible in CSS (`linear()` only approximates one), so a spring usually means a JS library and its bundle cost.

**Configure with duration + bounce**, not mass/stiffness/damping. It's far easier to reason about.

```js
{ type: "spring", duration: 0.3, bounce: 0 }        // UI text/state swaps
{ type: "spring", visualDuration: 0.5, bounce: 0 }  // default for gesture-driven motion
{ type: "spring", visualDuration: 0.5, bounce: 0.2 } // end of a drag, playful
{ type: "spring", stiffness: 100, damping: 10, mass: 0.75 } // physics form, rarely needed
```

- **Use `visualDuration` for anything gesture-driven.** A `duration` spring starts from rest and ignores the release velocity. Fixed-time transitions can keep `duration`.
- **Bounce defaults to 0.** Bounce is personality: zero reads serious, more reads playful. Add 0.1–0.3 (never more) only intentionally, for example at the end of a drag, where the finger applied force. A press-to-close or a dialog gets none.
- **Smaller elements need more bounce** to read the same amount.
- **Weird-looking spring motion is usually fixed by increasing damping.**
- **Interruptibility is the main reason to choose a spring.** A spring redirected mid-motion carries its current velocity into the new target. A keyframe animation restarts from zero.
- **Springs lag the finger.** A value that must track a gesture 1:1 uses a raw motion value, not a spring. See [animation-gestures-scroll.md](animation-gestures-scroll.md).

## Interruptibility

Anything that can be triggered again or reversed before it finishes (toasts, toggles, drawers, accordions, menus, drags) must animate from its current state. CSS transitions and springs retarget from the live position; `@keyframes` restart from frame one, so a drawer closed mid-open jumps to fully open and then plays the close. Toasts jumping when a new one arrives is the same bug.

- Anything the user can toggle: transition or spring.
- Keyframes only for sequences that always run to completion: loaders, loops, a one-shot first-run entrance.

Test it: open and close each drawer, menu, and accordion as fast as you can and watch for jumps.

## Physicality and origin

### Never enter from scale(0)

Nothing in the real world appears from nothing; even a deflated balloon has a shape. Start entrances at `scale(0.95)` with `opacity: 0` (`0.97` for small elements, `0.98` for large floating panels like a nav menu: the bigger the element, the closer to 1). Keep travel small, 8–16px, unless the element really comes from off-screen like a drawer.

```css
/* Wrong */
@keyframes pop { from { transform: scale(0); } }
/* Right */
@keyframes pop { from { transform: scale(0.95); opacity: 0; } }
```

### Scale from the trigger

Popovers, dropdowns, tooltips, and context menus scale from the side of the trigger that opened them, creating cause and effect. The default `transform-origin: center` is wrong for almost every triggered element.

```css
.popover  { transform-origin: var(--radix-popover-content-transform-origin); }       /* Radix popover */
.dropdown { transform-origin: var(--radix-dropdown-menu-content-transform-origin); } /* Radix menu */
.popup    { transform-origin: var(--transform-origin); }                             /* Base UI */
.menu     { transform-origin: top center; }                                          /* manual, trigger above */
```

Modals are exempt: they appear centered and keep `transform-origin: center`.

### Press and hover scale

- **Press:** `scale(0.97)` on `:active`, ~150ms ease-out transition so a mid-press release glides back. Press feedback is felt, not seen: if you can clearly see the button shrink (`0.9`), it's too much. Never below `0.95`.
- **Hover:** 1–2% (`scale(1.02)`), 100–150ms. `hover:scale-105` inflates like a balloon. A hover scale on something not clickable is a false affordance.
- Buttons feel best with both hover and press feedback. A hover with nothing on click feels dead, as if the click wasn't received.
- Never lift (translate) the hovered element itself; it moves out from under the cursor and flickers. Animate a child. See [animation-css.md](animation-css.md).

## Enter and exit

### Paired elements share timing

Modal + overlay, drawer + backdrop, tooltip + arrow: if they move as a unit, give them identical duration and easing. A 300ms modal over a 150ms backdrop reads as two unrelated things.

### Exits are quieter than enters

By the time something leaves, attention has moved on.

- Fade with a small directional nudge, a fixed few pixels (`translateY(-8px)` to `-12px`), never the element's full height.
- ~150ms out against ~250ms in.
- A hint of direction tells the eye where it went; a pure fade loses that.
- Don't cut to `display: none` instantly; that severs the spatial context the entrance built. In React, an `exit` with no presence wrapper never plays (see [animation-motion-react.md](animation-motion-react.md)).
- Reserve a full off-screen slide for when the destination is the information: a swiped-away card, a closing drawer.

### Exit the way you entered

A sidebar that slides in from the left lives to the left; fading it out contradicts that. Sonner toasts enter and exit the same way, which is what makes swipe-to-dismiss feel intuitive. Navigation maps forward = content moves left, back = content moves right. Animating against the action contradicts it.

### Object permanence

A view that opens from a thumbnail or card expands from where it sits; it doesn't cross-fade in full-screen while the thumbnail vanishes. The eye loses the thing it was tracking.

### Asymmetric timing

Slow where the user is deciding, fast where the system responds. A hold-to-delete fills slowly and linearly while held (it's a progress indicator), and snaps back in ~200ms ease-out on release. One shared timing would make the cancel feel broken. Symmetric timing on a press-and-release or hold interaction is a bug.

### Don't animate the initial page load

Anything sitting in its resting state when the page first paints should not play an entrance: tab indicators sliding into place, icons playing their swap on mount, a sidebar animating open on every navigation. Save motion for changes the user causes. The exception is a genuine first-run entrance (a staggered hero), which should play once and not replay on back-navigation.

### Crossfades

- For small, structurally similar content, prefer a crossfade with a small directional hint (8px shift + opacity + light blur) over a full `translateX(100%)` slide inside a small container. Calmer, and the eyes barely move.
- When a crossfade still reads as two overlapping objects, add `filter: blur(2px)` during the transition. It bridges the states into one perceived transformation. Keep blur well under 20px.

## Component recipes

Values assume ease-out for enter/exit, transform and opacity only, and a reduced-motion path for everything. Keep the values; adapt the syntax to the stack.

### Modal / dialog

- Enter: opacity 0 → 1 and `scale(0.95–0.97)` → 1, 200–250ms, `cubic-bezier(0.32, 0.72, 0, 1)`.
- Exit: same properties, ~150–180ms.
- Overlay fades with identical duration and easing.
- `transform-origin: center`.
- Avoid sliding in from off-screen, scaling from 0, or bouncing. A dialog is an interruption, not a toy.

### Popover / dropdown menu

- Fade + `scale(0.95)` → 1, 150–200ms ease-out, origin from the trigger.
- Optional nudge: `translateY(-4px)` → 0 when opening downward.
- No stagger on menu items.
- Keyboard navigation inside the menu moves the highlight instantly. A menu opened from a keyboard shortcut many times a day doesn't animate at all.

### Tooltip

- Fade + `scale(0.97)`, ~125ms ease-out, origin-aware.
- The first tooltip waits for a hover delay (~500ms) so tooltips don't fire on incidental mouse travel. Once one is open, moving to a sibling opens it instantly with no delay and no animation. This feels faster without defeating the delay.
- Base UI marks the skip with `[data-instant]`; Radix with `[data-state="instant-open"]`. Both only skip between tooltips sharing one provider, so mount the provider once (Radix `Tooltip.Provider` with `skipDelayDuration`), not per tooltip. shadcn's `Tooltip` mounts one per tooltip by default.

```css
.tooltip { transform-origin: var(--transform-origin); transition: transform 125ms ease-out, opacity 125ms ease-out; }
.tooltip[data-starting-style],
.tooltip[data-ending-style] { opacity: 0; transform: scale(0.97); }
.tooltip[data-instant] { transition-duration: 0ms; }
```

### Toast

- Enters with translate + fade from its screen edge (bottom: `translateY(100%)` or 16px → 0), 200–400ms. Sonner uses 400ms `ease` deliberately for an elegant feel; product toasts default to 200–250ms ease-out.
- Exit: fade + small translate toward the edge, faster, matching the entry direction.
- When stacking, move existing toasts with `transform` transitions (never re-layout, never keyframes) so a toast arriving mid-flight retargets smoothly. Swipeable toasts use a spring.

### Drawer / sheet

- Slides from its edge with a translate transition, 250–300ms ease-out enter, faster exit; up to 500ms for a full-height sheet on `cubic-bezier(0.32, 0.72, 0, 1)`.
- Backdrop fades with the same timing.
- Use percentage translate (`translateY(100%)`) so a sheet of any height hides by exactly its own height.
- Must be interruptible: users close drawers mid-open.
- Draggable sheets use a spring with `visualDuration` so release velocity carries through. Drag thresholds are in [animation-gestures-scroll.md](animation-gestures-scroll.md); Vaul handles this.
- All sub-animations of one drawer share a timing feel. A small floating drawer that changes height overrides Vaul's 500ms down to ~200–270ms so opening and resizing read as one thing.

### Button press

```css
.button { transition: transform 150ms cubic-bezier(0.25, 0.46, 0.45, 0.94); }
.button:active { transform: scale(0.97); }
```

Bake an opt-out into the Button component (a `still` prop) for dense or high-frequency UI, and skip the scale on disabled buttons (`active:not-disabled:scale-[0.97]`).

### Contextual icon swap

Icons that change with state (copy → check, play → pause, like → liked) cross-fade instead of toggling visibility: `scale` 0.3 → 1, opacity 0 → 1, `blur(3px)` → 0, on `{ type: "spring", duration: 0.35, bounce: 0 }`. A timid scale (0.8–0.9) reads as a glitch; a deep one reads as a swap. Without a spring, layer both icons and cross-fade with classes on `cubic-bezier(0.25, 0.1, 0, 1)` over ~300ms. Good for state toggles, hover-revealed actions, loading → success. Not for permanent nav icons or decorative marks.

### Text and number swaps

Use `tabular-nums` on changing digits so widths don't shift. Text that changes the consequence of the next click (Delete 1 item → Delete 5 items) can morph to emphasize the change: old text exits `y: 25` while new enters from `y: -25`, opacity, spring `{ duration: 0.3, bounce: 0 }`.

### Loaders

Spinners spin at a constant rate (`linear`). Spin faster rather than slower: perceived speed is real.

## Stagger and orchestration

- **List and per-word reveals:** 30–50ms per item, up to 80ms. Cap the total: stagger × count stays under ~400ms. A 150ms stagger across twelve items makes the user wait two seconds.
- **Hero / section entrance:** split the content into meaningful pieces (heading, supporting copy, CTA) instead of moving one wrapper, and offset each by ~100ms (up to four blocks). The softest layered enter: fade + `translateY(8px)` → 0 + `blur(2px)` → 0.
- **Vary by importance.** The most important element leads and gets the most screen time; supporting lines follow with increasing delay; the least important element only fades, with no slide. Uniform stagger (same delay, distance, easing per item) deadens motion the way `linear` deadens easing.
- **One entrance per container.** Don't slide a panel in and also trickle its children in. Slide the panel in with content already there so the user can read immediately.
- **Stagger is decorative.** It must never block interaction.
- **No stagger in menus and dropdowns** seen daily.

## When something feels off

| Symptom | Likely cause and fix |
| --- | --- |
| Feels sluggish | `ease-in`, a weak built-in curve, or duration over 300ms. Swap to a strong ease-out custom curve, then shorten |
| Feels flat or lifeless | Curve too weak, or `linear` on non-constant motion |
| Appears from nowhere | `scale(0)` or `transform-origin: center` on a triggered element |
| Jumps when retriggered | Keyframes on toggled UI; use a transition or spring |
| Hover flickers | The hovered element moves itself; animate a child |
| Modal and backdrop feel disconnected | Mismatched durations or easings |
| Two states read as separate objects | Add `blur(2px)` during the crossfade |
| 1px shift at start or end | CPU/GPU handoff; `will-change: transform` (see [animation-performance-accessibility.md](animation-performance-accessibility.md)) |
| Everything transitions on theme toggle | Disable transitions during the theme swap (see [animation-css.md](animation-css.md)) |
| Can't tell what's wrong | Record it and scrub frame by frame, or slow playback to 10% in DevTools Animations; check origin, easing ending abruptly, coordinated properties drifting |

Feel can't be fully judged from code. Test gestures on a real device (hit the dev server by IP), and review motion with fresh eyes the next day rather than shipping it in the sitting you wrote it.

When fixing existing motion, prefer earlier moves: (1) delete it, (2) reduce it, (3) fix the easing, (4) fix origin and scale values, (5) make it interruptible, (6) move it to transform/opacity, (7) make timing asymmetric, (8) polish (blur, stagger hierarchy), (9) reduced motion and cohesion.

## Reduced motion and performance

Every animation ships with a reduced-motion path when you write it: remove movement (translate, scale, rotate, parallax, autoplaying loops) and keep opacity and color changes at 200ms or less so state changes still register. Animate only `transform` and `opacity` for movement and size. Details in [animation-performance-accessibility.md](animation-performance-accessibility.md).

## Checklist

- Frequency checked: nothing animates on keyboard actions or 100+/day interactions.
- Each animation has a one-sentence purpose.
- Enter/exit uses a custom ease-out curve; on-screen movement uses ease-in-out; no `ease-in` on entrances, hovers, or presses; `linear` only for constant motion.
- Product UI durations under 300ms (page transitions 300–400ms), duration tuned to the curve, exits 20–30% faster.
- No `scale(0)`; entrances start at 0.95–0.98 with opacity.
- Popovers, dropdowns, and tooltips scale from their trigger; modals stay centered.
- Toggled or interruptible UI uses transitions or springs, never keyframes.
- Paired elements share duration and easing; exits leave the way they entered.
- Press is `scale(0.97)`; hover scale is 1–2%.
- Gesture springs use `visualDuration`, bounce 0 unless deliberate (max 0.3).
- Stagger 30–80ms per item, total under ~400ms, varied by importance; one entrance per container.
- Reduced-motion path exists for every animation.
