# Interaction Details

The behavior between someone's input and the interface's response: hover intent and delays, tooltips, menus and popovers, presses, keys, timers, and confirmation feedback. Read this when building or reviewing anything people hover, press, open, type into, or wait on, or when an interaction works but feels off. Drag thresholds, tension, velocity, and release physics live in [animation-gestures-scroll.md](animation-gestures-scroll.md).

## Before writing code

1. **Find the primitive.** Check what the project already uses: Radix, Base UI, React Aria, Vaul, Sonner, Motion. Most details below are a prop on a component you already have (`skipDelayDuration`, `delay`, `duration`). Use the prop instead of rebuilding it. When fixing hand-written code, fix it in place and name the library in your report; don't migrate unasked.
2. **Find where the library's defaults are wrong.** Defaults exist so the component works, not so it feels right: Radix tooltips wait 700ms, shadcn's `Tooltip` gives every tooltip its own provider with no delay.
3. **Match the file.** Follow how the codebase already handles pointer events, timers, and motion values.

## The walk

Run every interactive element through these questions. Each "yes" points at a section below.

```
1. Can it fire by accident?              (a pointer passing over, a scroll starting on a button)
   └── Yes → add intent: a delay or a distance it must clear first.          → Hover intent
2. Will people do it many times in a row? (sweeping a toolbar, arrowing a menu, a shortcut)
   └── Yes → the second time skips what the first one needed.                 → Tooltips, Keys
3. Does the pointer cross gaps on the way? (toolbar buttons, menu to submenu, trigger to hover card)
   └── Yes → close the gaps so moving between parts never counts as leaving.  → Gaps
4. Can they look away or change their mind? (a toast while they read, a press dragged off)
   └── Yes → wait for them, and let them back out.                            → Presses, Timers
```

## Hover intent

Things that react to the pointer passing by feel jumpy. Each hover-opened surface waits as long as an accidental open would cost.

| Surface | Open | Close | Why |
| --- | --- | --- | --- |
| Submenu | 100ms | when the safe area gives up | Small, attached to where the pointer already is |
| Navigation menu | 200ms, then instant for 300ms after one closes | 150ms | The pointer heading for the page crosses the nav bar; once one is open the user is browsing |
| Tooltip | 500ms, then instant for 300ms | at once (~100ms fade) | Labels; see Tooltips |
| Hover card / preview | pointer at rest for 600ms | 300ms | Covers content, needs real intent; holds content the pointer moves into |
| Decorative hover effect | ~100ms | only if the hover-in ran | A cursor crossing the page shouldn't leave half-played animations behind |

- **"At rest" means the timer restarts on every movement.** Moves smaller than about 1.4px (`movementX² + movementY² < 2`) are hand tremor and don't restart it.
- **Hover comes from a pointer that moved.** Scrolling slides content under a still cursor and fires `pointerenter`: every card in a scrolled grid lifts and tooltips pop up. Start hover UI from `pointermove`, or ignore enters that arrive while the page is scrolling.
- **Hover comes from a mouse.** CSS hover sits behind `@media (hover: hover) and (pointer: fine)`. A JS hover handler checks `e.pointerType === "mouse"` and ignores mouse events for 50ms after a touch `pointerup`: iOS fires an emulated `pointerenter` with `pointerType: "mouse"` after every tap, so the type check alone misses it. Touch-laptops match `hover: hover`, so media queries alone fail on hybrids.
- **The hover target never moves.** If hovering a card lifts or scales it, the card slides out from under the pointer, hover ends, it drops back, hover starts again: a flicker at the edge. Listen for hover on a parent that stays put and animate a child.
- **Menu and list highlights are instant.** No transition on the highlight background. Anything eased trails the cursor one item behind.
- **Hover reveals also reveal on focus.** Anything that appears on `:hover` also appears on `:focus-visible` (or `:focus-within` for a container). Hover enhances; it never holds the only path to an action. See [touch-accessibility.md](touch-accessibility.md).
- **On hover, confirm affordance.** Pair a color change with the right cursor and, for text links, an underline. Keep hover transitions around 150ms; 400ms feels like the UI is thinking.

## Tooltips

| | Value | Why |
| --- | --- | --- |
| First tooltip in a group | 500ms delay, then a 125ms fade + `scale(0.97)` from the trigger side | A pointer crossing the page shouldn't light up every label |
| Every tooltip after it | 0ms delay, no animation | The user is reading labels now; 500ms per button turns a sweep into stop-and-wait |
| Warm window | 300ms after the last tooltip closes | Long enough to cross to the next trigger, short enough that coming back later is a fresh request |

- **One provider around the whole group.** Skip-delay only works between tooltips that share a provider. Mount one at the app root and none inside individual tooltips. A toolbar that needs different delays can nest its own.
  - Radix: `<Tooltip.Provider delayDuration={500} skipDelayDuration={300}>` (defaults 700 / 300).
  - Base UI: `<Tooltip.Provider delay={500} timeout={300}>` (defaults 600 / 400).
  - **shadcn/ui** wraps every tooltip in its own `TooltipProvider` with `delayDuration = 0`. Nothing is ever warm and every label flashes on as the pointer passes. Mount one provider at the root with the values above, remove the per-tooltip provider from `components/ui/tooltip.tsx`, and drop its slide-in in favor of the fade + `scale(0.97)`.
- **Kill the animation when instant, not only the delay.** A tooltip that skips its delay but still fades for 125ms lags behind the pointer. The tooltip being replaced closes instantly too, so the two never overlap mid-sweep.

```css
.tooltip {
  transform-origin: var(--transform-origin);
  transition: transform 125ms ease-out, opacity 125ms ease-out;
}
.tooltip[data-starting-style],
.tooltip[data-ending-style] { opacity: 0; transform: scale(0.97); }

/* Base UI */
.tooltip[data-instant] { transition-duration: 0ms; }
/* Radix */
.tooltip[data-state="instant-open"] { animation: none; }
```

- **Close faster than you open** (about 100ms), and never put the intent delay on closing. On the way out it only holds a stale label on screen.
- **A click on the trigger closes its tooltip**, and it stays closed until the pointer leaves and returns. The user moved from reading to acting, and the tooltip would cover what the click changed. Focus caused by a pointer press doesn't open it; any scroll closes it.
- **Keyboard focus opens a tooltip immediately.** Focus via Tab, or a readout for a shortcut just pressed, gets 0 delay: the user asked for it.
- **Toolbar hit areas touch.** Space buttons with padding inside the hit area, not margins between them. A dead strip closes the tooltip mid-sweep and the next one reopens: a flicker on every crossing.
- **Tooltips label; they don't hold.** Nothing clickable inside a tooltip (it can't be focused, so a link inside is unreachable), and nothing only a tooltip says (touch users never see it). Interactive content goes in a popover opened by click.
- **Surface shortcuts in the tooltip:** `Save (⌘S)` on Mac, `Save (Ctrl+S)` elsewhere. Platform detection is in [touch-accessibility.md](touch-accessibility.md).

## Menus, selects, and popovers

### Positioning

- **Use the library's positioning** (Radix, Base UI, Floating UI). It handles collision: flipping to the other side when there's no room, shifting along the edge, and constraining height. Hand-positioned popovers clip at the viewport edge.
- **Cap height to the space available** and scroll inside: `max-height: var(--radix-popper-available-height)` (Radix) or `var(--available-height)` (Base UI).
- **Leave a small offset from the trigger** (`sideOffset={4}`–`8`) and bridge that gap for hover-opened surfaces (see Gaps).
- **Scale from the trigger, not the center.** Popovers, dropdowns, and tooltips set `transform-origin` from the side they opened on. Both libraries expose it and it flips with collision:

```css
.popover {
  transform-origin: var(--radix-popper-transform-origin, var(--transform-origin, top));
}
```

A modal centered in the viewport keeps `transform-origin: center`; that is correct. Durations and easing for these entrances are in [animation-principles.md](animation-principles.md).

### Opening

```
How did the press arrive?
├── Mouse, primary button, no Ctrl → open on pointerdown.
│   Press-drag-release picks an item in one motion, like native menus.
├── Touch or pen → open on click.
│   A scroll that starts on the trigger never fires a click, so it never opens the menu.
└── Keyboard (Enter, Space, ArrowDown) → open with an item highlighted.
```

- **What's highlighted on open:** an action menu opened by keyboard highlights its first item (ArrowUp: its last); opened by pointer, nothing, because a highlight under an unmoved pointer makes Enter do something the user never chose. A select always opens on its current value, scrolled so that value sits under the trigger; with no value, the first enabled option.
- **The release from the opening press doesn't pick anything unless the pointer travelled.** A select lines its current item up under the trigger, so a plain click's `pointerup` lands on an item. Ignore that `pointerup` if the pointer moved 10px or less since `pointerdown`. Without this guard every click re-picks the current value and closes the select.
- **Press, drag, release outside the menu closes it.** Give the trigger ~2px of slack so a trembling click doesn't count as leaving.
- **The trigger is not "outside".** A press on the trigger of an open menu closes it once. If the outside-press handler counts the trigger as outside, it closes and the trigger reopens it.
- **On a Mac, Ctrl+click is a right-click.** A handler that opens on `pointerdown` checks `e.button === 0 && !e.ctrlKey`, or the dropdown and the context menu open together.
- Radix DropdownMenu opens on `pointerdown` for every pointer type, so on touch in a scrolling list it can open on a scroll. Mention it in your report instead of patching the library.

```tsx
// pointerdown handles the mouse; click handles touch, pen, and the click a
// keyboard or screen reader fires (detail === 0).
const pointerType = useRef("touch");

<button
  type="button" // inside a form, a bare <button> submits it
  onPointerDown={(e) => {
    pointerType.current = e.pointerType;
    if (e.pointerType === "mouse" && e.button === 0 && !e.ctrlKey) {
      e.preventDefault(); // keeps focus on the list, prevents text selection
      open ? close() : openList("pointer");
    }
  }}
  onClick={(e) => {
    if (e.detail === 0) openList("first"); // Enter or Space
    else if (pointerType.current !== "mouse") open ? close() : openList("pointer");
  }}
  onKeyDown={(e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openList(e.key === "ArrowDown" ? "first" : "last");
    }
  }}
/>
```

### Context menus

- **Right-click opens on `contextmenu`, and the release decides.** Released over an item, it picks that item. Released elsewhere within 500ms, the menu stays open; later, it closes (the user held, looked, and let go). The opening press can't also dismiss it as an outside press: hold outside-press dismissal for 500ms after opening.
- **On touch, it's a long press:** 500ms, cancelled by more than 10px of movement (see Presses).

### Highlighting

- **Highlight on `pointermove`, not `pointerenter`, and only for `pointerType === "mouse"`.** Arrowing through a list scrolls items under a still pointer; `pointerenter` fires on them and steals the keyboard's highlight. `pointerleave` clears it.
- **The pointer never scrolls the list; the keyboard does.** A hover highlight focuses with `focus({ preventScroll: true })`, or hovering a half-visible last item scrolls the list, a new item slides under the cursor, and the list runs away. The keyboard highlight calls `scrollIntoView({ block: "nearest" })`.

### Typeahead

Menus, selects, listboxes, and trees jump to an item when the user types its name.

- Typed characters accumulate into one search, reset **1000ms** after the last key (500ms cuts off slower typists mid-word).
- Typing the same letter again cycles: `b`, `b`, `b` steps through Banana, Blueberry, Brie.
- A single letter searches from the item after the current one; a longer search starts at the current one. Both wrap.
- Space is part of the search while the buffer isn't empty, so "new y" doesn't select the item highlighted at "new ".

```ts
const search = useRef("");
const timer = useRef<number | undefined>(undefined);

// Call first in the list's keydown. null: not a typeahead key. A number: the key
// went into the search; preventDefault() and highlight that index.
function onTypeahead(e: KeyboardEvent, labels: string[], current: number): number | null {
  if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.key === " " && search.current === "") return null; // Space selects

  search.current += e.key.toLowerCase();
  clearTimeout(timer.current);
  timer.current = window.setTimeout(() => (search.current = ""), 1000);

  const s = search.current;
  const query = [...s].every((c) => c === s[0]) ? s[0] : s; // "bbb" cycles on "b"
  const start = query.length === 1 ? current + 1 : Math.max(current, 0);
  for (let i = 0; i < labels.length; i++) {
    const index = (start + i) % labels.length;
    if (labels[index].toLowerCase().startsWith(query)) return index;
  }
  return current;
}
```

### Submenus and the safe triangle

- **A submenu opens after ~100ms of hover.** Opening on `pointerenter` flashes every submenu the pointer crosses on its way down. The arrow toward the submenu opens it and highlights its first item; the arrow back closes it and returns to the parent item. Resolve ArrowLeft/ArrowRight from the writing direction, not hard-coded.
- **A safe area that reads the pointer's direction keeps it open**, not a flat grace timer (which makes every ordinary up/down move in the parent lag). The diagonal path toward the submenu otherwise crosses the next item and closes it. Radix and Base UI do this; a hand-built menu needs:
  - On each `pointermove` (throttled to 50ms), take the angle of the move from the previous position. It's heading for the submenu if it points between the submenu's near top and near bottom corners, widened by 15° on each side.
  - While heading there, the parent's items ignore the pointer (`pointer-events: none` on the parent menu).
  - A move in any other direction hands the pointer straight back. Moving up and down the parent never waits.
  - A pointer that stops on its way gets 1000ms, then the item under it wins.
  - Drop it once the pointer lands in the submenu; skip it for touch and pen.
- A static `clip-path` triangle doesn't follow the pointer. Don't ship one.

### Hover-opened surfaces

- **Content the pointer moves into gets a close delay; a label doesn't.** A hover card or nav panel waits ~150–300ms on `pointerleave`, so the trip across the gap doesn't close it. A tooltip closes at once.
- **A hover-opened popover ignores a click on its trigger for 500ms.** The user was already clicking when hover opened it; without this the click toggles it shut.
- **A hover card stays open while text inside it is selected or the pointer is down inside it.**
- **Hover-opened surfaces need a non-hover way in.** Focus opens them too. On touch the trigger's tap is its own action, so nothing may live only in a hover card.
- **Marketing nav submenus render their content in the DOM and hide it**, rather than mounting on hover, so screen readers and crawlers see the structure.

### Dismissing

- **Topmost layer only.** Escape or an outside press closes the top layer. A select open inside a modal closes the select and leaves the modal. Portalled popovers sit outside the modal in the DOM, so the modal's outside-click handler fires unless the library treats them as nested layers (Radix and Base UI do; hand-built ones need it).
- **A press that started inside never dismisses, wherever it ends.** Selecting text in a popover and releasing past its edge is still using it. Remember where `pointerdown` landed.
- **An outside press dismisses on `pointerdown` with a mouse, on `click` on touch.** A scroll that starts outside fires no click, so on touch the popover survives a scroll.
- **Escape while an IME is composing cancels the composition**, not the popover (see Keys).
- **Focus after close depends on how it closed.** Escape, or picking an item, returns focus to the trigger. Clicking elsewhere leaves focus where the click put it. Modal dialogs always return focus ([touch-accessibility.md](touch-accessibility.md)).

## Gaps the pointer crosses

When hover keeps something open (an expanded toast stack, a hover card, a mega-menu), every gap between its parts is a place where the pointer is suddenly outside. Fill them:

```css
/* Each expanded toast fills the gap above it. +1px covers subpixel seams. */
.toast[data-expanded="true"]::after {
  content: "";
  position: absolute;
  left: 0;
  bottom: 100%;
  width: 100%;
  height: calc(var(--gap) + 1px);
}
```

- A trigger and its hover card are one hover area. Bridge the offset with a pseudo-element on the content, or use the library's grace area.
- Something leaving keeps its hit area until it's gone, or the stack thinks the pointer left and collapses mid-exit.
- Don't collapse on `pointerleave` while the pointer is down. A swipe that drifts outside is the same interaction.

## Presses

```
pointerdown on the target   → show pressed (on touch inside a scroller, wait ~100ms first)
pointer leaves the target   → drop the pressed look; the press is still alive
pointer comes back          → pressed look returns
release over the target     → fire
release anywhere else       → nothing
an ancestor scrolls         → cancel: no pressed look, nothing fires
pointercancel               → cancel
```

- **Show the press on `pointerdown`, act on `click`.** `:active` answers the touch at once; the action waits for `click`, which fires for keyboard and pointer and only when the press is released on the same element, so sliding off cancels. Never act on `mousedown` (no way to back out) or `mouseup` (skips keyboard, fires when the press started elsewhere). Menus and selects are the exception (see Opening).
- **Press feedback:** `transform: scale(0.97)` on `:active` with a ~150ms ease-out transition so a mid-press release glides back. Never below `0.95`. More in [animation-css.md](animation-css.md).
- **Sliding back on re-arms the press.** Judge "over the target" by the contact area (`pointer.width`/`height`), so a fat-finger release at the edge still counts.
- **Scrolling cancels a press.** While held, listen for `scroll` on the document in the capture phase; any ancestor scrolling cancels it.
- **On touch, rows inside a scroller wait ~100ms before showing pressed**, or every row the thumb scrolls across lights up. `:active` can't be delayed, so drive the look from a `data-pressed` attribute set by a 100ms timer on `pointerdown`, cleared on scroll, `pointercancel`, or release. A tap that lifts before 100ms still sets it for ~100ms so the tap registers. Buttons outside a scroller show pressed immediately.
- **A control that acts on `pointerdown` ignores the `click` that follows**, except `e.detail === 0` (keyboard or screen reader).
- **Buttons inside an input never take its focus from a pointer.** A clear button, stepper, or password reveal calls `preventDefault()` on `mousedown` and acts on the input, so the caret stays and the phone keyboard stays open.
- **Interrupting a drag:** a drag that ends on a button doesn't click it. Thresholds and the rest are in [animation-gestures-scroll.md](animation-gestures-scroll.md).

### Long press

- **500ms, cancelled by more than 10px of movement.** Cancelling on any movement is too strict for a finger.
- **When it fires, the release doesn't also click.** Mark the press consumed and swallow the next `click`.
- **Suppress the native callout and selection:** `-webkit-touch-callout: none` and `user-select: none` while held; restore selection ~300ms after release, since iOS can start one if restored immediately.
- **Quick press acts, held press reveals.** The tap does the default with no extra UI; the hold shows the choices. Never make the common case wait 500ms.
- **A long press always has another way in:** right-click, a visible "more" button, or a shortcut.

### Hold to repeat and double-click

- **Steppers step once on press, then repeat after 400ms, every 60ms.** Stop at min and max. On touch, more than ~8px of finger movement stops the repeat (it's a scroll).
- **Modifier keys change the step.** Shift+arrow or PageUp/PageDown step by 10; Home/End jump to min/max.
- **Read `e.detail` for double-click**, don't run a timer: it follows the OS double-click speed. Never delay a single click to see if a second one comes; design click as the first half of double-click (click selects, double-click opens).
- **Rapid clicks don't select text:** `onMouseDown={(e) => { if (e.detail > 1) e.preventDefault(); }}` on steppers and buttons pressed in quick succession.

### Hold to confirm

Fill over ~2s with `linear` (it shows time passing); releasing early drains it in ~200ms with `ease-out`. Mirrored timing makes backing out feel like a second commitment.

## Keys

- **Shortcuts act on `keydown`.** Buttons act on `click`; a key has no "drag off" to cancel, and waiting for `keyup` adds lag.
- **Bind the platform modifier:** `e.metaKey` on Mac, `e.ctrlKey` elsewhere (or accept `e.metaKey || e.ctrlKey`), and show the matching label.
- **Single-letter shortcuts don't fire while typing** in an input, textarea, `select`, or `contenteditable`.
- **Never fire a shortcut while an IME is composing.** In Japanese, Chinese, or Korean input, Enter confirms the word. Check `e.isComposing || e.keyCode === 229` before Enter-to-send and single-letter shortcuts. Safari fires `compositionend` before the keydown that ended it, so for Enter-to-send and Escape-to-close also track a flag set on `compositionstart` and cleared 5ms after `compositionend`.
- **Key auto-repeat is for things that step.** Arrow navigation and steppers accept `e.repeat`. Anything that opens, toggles, or submits ignores it, or holding Enter on a menu button opens it and then picks an item.
- **Keyboard-driven changes don't animate.** A ⌘K menu, a highlight moving with arrows, a list reordered by shortcut: show the result on the next frame. The hands are already ahead of the animation.
- **A shortcut that triggers a button also shows it pressed.** A shortcut never puts the button into `:active`, so set a `data-pressed` attribute for ~150ms. Use an attribute, not a class: a React re-render rewrites `className` and wipes it.

```ts
function flashPressed(el: HTMLElement) {
  el.setAttribute("data-pressed", "");
  setTimeout(() => el.removeAttribute("data-pressed"), 150);
}
```

### Wheel and trackpad

- **A trackpad swipe is one gesture.** It sends a burst of `wheel` events with an inertia tail. Treat the burst as one gesture ending after ~150ms of silence, pick its axis once (`|deltaX| > |deltaY|`), and normalize `deltaMode === 1` at 16px per line. Anything discrete (a carousel, a stepped timeline) moves one step per gesture.
- **The wheel changes a number field only while it's focused**, with `preventDefault()` so the page doesn't also scroll. Over an unfocused field it scrolls the page.
- **`ctrlKey` on a wheel event is a trackpad pinch.** On a zoomable canvas it's zoom: keep the point under the cursor fixed and multiply, `scale *= Math.exp(-clamp(e.deltaY, -10, 10) * 0.01)`.
- **Scrubbing a value by dragging uses pointer lock** (`requestPointerLock()`), stepping once per ~2px of movement. Skip it on touch.

## Timers

Anything that disappears on its own (toasts, auto-advancing slides, "Copied" states) runs on a timer the user didn't start.

- **Pause while hovered, pressed, focused inside, and while the tab is hidden or the window blurred.** A toast that expires while they read it, or in a tab they weren't looking at, was never seen. `visibilitychange` doesn't fire when they switch apps with the browser still visible, so also listen to window `blur`/`focus`.
- **Resume from what was left.** A 4000ms toast hovered at 3500ms has 500ms left. Restarting the full timer makes toasts linger.
- **Real deadlines never pause.** A session expiry or reservation hold keeps its absolute end time and recomputes what's left when the tab returns.
- **Pause the whole stack together**, so none expire behind the one being read.
- **Toast lifetimes:** 4000ms informational, 6000ms with an action like Undo. Never a flat 2s. Loading toasts never auto-close; a resolved one starts a fresh timer.
- **The same toast fired twice updates the one on screen.** Give it a stable `id` (Sonner replaces by id) and restart its timer, so three saves show one "Saved".
- **Never `setTimeout(fn, Infinity)`.** It overflows and fires immediately. A toast that should stay gets no timer.
- **After a toast that holds focus is removed, re-check** `stack.contains(document.activeElement)`; no reliable `focusout` follows and the stack stays paused forever.

Hover, press, and focus overlap, so track why it's paused. A plain `pause()`/`resume()` pair subtracts elapsed time twice when reasons overlap and the toast expires early.

```ts
type Hold = "hover" | "press" | "focus" | "hidden" | "blurred";

function createTimer(duration: number, onExpire: () => void) {
  const holds = new Set<Hold>();
  let remaining = duration;
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false;

  const run = () => {
    if (done || remaining === Infinity) return;
    startedAt = Date.now();
    timer = setTimeout(() => { timer = undefined; done = true; onExpire(); }, remaining);
  };
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
    remaining -= Date.now() - startedAt;
  };

  if (typeof document !== "undefined") {
    if (document.hidden) holds.add("hidden");
    if (!document.hasFocus()) holds.add("blurred");
  }
  if (holds.size === 0) run();

  return {
    hold(reason: Hold) {
      if (holds.has(reason)) return;
      holds.add(reason);
      if (holds.size === 1 && timer !== undefined) stop();
    },
    release(reason: Hold) {
      if (!holds.delete(reason)) return;
      if (holds.size === 0) run();
    },
    clear() { done = true; clearTimeout(timer); },
  };
}
```

Wire `"hover"` to `pointerenter`/`pointerleave` and `"focus"` to `focusin`/`focusout` on the stack; `"press"` to `pointerdown` on the stack with `pointerup`/`pointercancel` on the document; `"hidden"` to `visibilitychange`; `"blurred"` to window `blur`/`focus`.

## Pending and confirmation feedback

- **Loading indicators have a minimum both ways.** Wait ~150ms before showing one so fast responses never flash it; once shown, keep it at least ~300ms so it never blinks. Only the visible indicator waits: the button disables the moment the request starts ([forms.md](forms.md)).
- **Anything over ~400ms without feedback reads as broken.** Show a spinner, skeleton, or progress.
- **Frequency decides how a write confirms.** Frequent, low-stakes writes (toggles, likes, renames, reorders) update optimistically and revert with a message on error. Rare or consequential ones (payments, deletes, sends) wait for the server and show a pending state.
- **Copy-to-clipboard confirms.** Swap the icon to a checkmark for ~1.5s, then revert. Without it, users click three more times to check it worked. Cross-fade the icons (scale 0.3 → 1, opacity, `blur(3px)` → 0) instead of toggling visibility; recipe in [animation-motion-react.md](animation-motion-react.md). Announce it for screen readers with a polite live region.

```tsx
const [copied, setCopied] = useState(false);
async function copy() {
  await navigator.clipboard.writeText(value);
  setCopied(true);
  setTimeout(() => setCopied(false), 1500);
}
<button type="button" onClick={copy} aria-label={copied ? "Copied" : "Copy"}>
  {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
</button>
<span role="status" className="sr-only">{copied ? "Copied to clipboard" : ""}</span>
```

- **Debounce search input at ~300ms.** A request per keystroke hammers the server and races.
- **Feedback is visible on the page.** Errors, confirmations, and status never hide behind hover or inside a modal.

## Numbers

| | |
| --- | --- |
| Tooltip first delay / warm window | 500ms / 300ms |
| Hover open: submenu / nav / hover card | 100ms / 200ms / 600ms at rest |
| Hover close: nav / hover card / tooltip | 150ms / 300ms / instant |
| Decorative hover intent | ~100ms |
| Ignore mouse after touch | 50ms |
| Long press | 500ms, cancelled past 10px |
| Hold to repeat | once, then 400ms, then every 60ms |
| Typeahead reset | 1000ms |
| Wheel gesture end | ~150ms of silence |
| Toast lifetime | 4000ms, 6000ms with an action |
| Spinner delay / minimum | 150ms / 300ms |
| Copied state | ~1.5s |

## Checklist

- [ ] One tooltip provider at the root: 500ms first delay, 300ms skip window, instant tooltips with no animation
- [ ] Hover effects gated by `@media (hover: hover) and (pointer: fine)`; JS hover checks `pointerType` and ignores emulated mouse after touch
- [ ] Hover targets don't move; toolbar hit areas touch; hover-held groups fill their gaps
- [ ] Popovers use library positioning with collision handling and scale from `transform-origin` of the trigger
- [ ] Menus highlight on `pointermove`, instantly; typeahead with a 1000ms reset; submenus 100ms with a direction-aware safe area
- [ ] Dismiss closes the topmost layer only; a press that started inside never dismisses; focus returns per how it closed
- [ ] Buttons show pressed on `pointerdown` and act on `click`; scrolling cancels a press
- [ ] Shortcuts act on `keydown`, use the platform modifier, skip while typing and while an IME composes, and flash the button's pressed state
- [ ] Keyboard-triggered UI doesn't animate
- [ ] Presentation timers pause for hover, press, focus, hidden tab, and blurred window, and resume from what was left
- [ ] Spinners wait 150ms and stay 300ms; copy buttons confirm with a checkmark for ~1.5s
