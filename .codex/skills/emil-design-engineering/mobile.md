# Mobile & Native Feel

The platform layer that decides whether a web app feels installed or embedded on a phone: viewport units, safe areas, the software keyboard, touch and tap behavior, scroll and overscroll, sheets, bottom navigation, haptics, platform conventions, and PWA basics. Read it when building or reviewing anything a phone will open, or when something "works in Chrome but feels wrong on my phone". Keyboard and screen-reader access live in [touch-accessibility.md](touch-accessibility.md); gesture physics live in [animation-gestures-scroll.md](animation-gestures-scroll.md).

## Ground rules

- **Use media queries and platform APIs, never device sniffing.** `(hover: hover)`, `(pointer: fine)`, `(pointer: coarse)`, `env()`, `dvh`. Never branch on user-agent strings or screen width to guess at touch. An iPad with a trackpad, a touchscreen laptop, and a phone with a mouse all exist; gate by capability.
- **Reach for CSS or a meta tag before JavaScript.** Almost every fix here is one declaration. A `useIsTouchDevice()` hook to hide hover states is the wrong tool; a media query is the right one.
- **Apply each fix where its reason applies.** `user-select: none` on a button is correct; on body text it is a defect.
- **Never disable zoom.** `user-scalable=no` and `maximum-scale=1` lock low-vision users out on browsers that obey them, and Safari ignores them for pinch zoom anyway. They usually exist to stop input zoom; fix the input font size instead.
- **Test on real hardware.** Sticky hover, the tap highlight, the URL bar's effect on `vh`, input zoom, the tap delay, rubber-banding, safe areas, and the keyboard do not reproduce in device emulation. Say which fixes were verified from code and which need a phone.

## Symptom table

| Symptom | Fix | Section |
| --- | --- | --- |
| Hover state stuck after a tap | `@media (hover: hover) and (pointer: fine)` | Hover |
| Gray/blue flash on tap | `-webkit-tap-highlight-color: transparent` | Tap feedback |
| Tap feels laggy | `:active` feedback + `touch-action: manipulation` | Tap feedback |
| Taps miss small buttons | 44px hit area via pseudo-element | Tap targets |
| Layout is the wrong height | `100dvh` (app shell) or `100svh` (hero) | Viewport units |
| Content stops at the notch or sits under the home indicator | `viewport-fit=cover` + `env(safe-area-inset-*)` | Safe areas |
| Page zooms into an input | Input font size 16px on coarse pointers | Inputs |
| Keyboard covers the input or CTA | `interactive-widget=resizes-content` (Android), `visualViewport` (iOS) | Keyboard |
| Keyboard opens by itself | No `autoFocus` on coarse pointers | Keyboard |
| Pull-to-refresh or page bounce hijacks scroll | `overscroll-behavior` | Scroll |
| Long-press selects button text | `user-select: none` on controls only | Long press |
| Carousel drags the page vertically | `touch-action: pan-y` | Gesture axes |
| Video opens fullscreen or won't autoplay | `muted` + `playsinline` | Video |
| Status bar color doesn't match | `theme-color` per scheme | Browser chrome |
| Anchor links land under the sticky header | `scroll-margin-top` | Sticky headers |
| Page pans sideways | Fix the overflowing element | Horizontal overflow |

## Baseline

Ship this before the first component in any app a phone will open. Merge it into existing root rules; never add a second viewport tag or global stylesheet.

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a0a0a" />
<meta name="color-scheme" content="light dark" />
```

```css
html {
  -webkit-tap-highlight-color: transparent;
  -webkit-text-size-adjust: 100%; /* no font inflation in landscape */
  overscroll-behavior: none;      /* app shells only; drop on a scrolling document */
}

input, textarea, select { font-size: 16px; }

button, a, input, select, textarea, [role="button"] { touch-action: manipulation; }

button, [role="button"] {
  user-select: none;
  -webkit-user-select: none;
}

@media (hover: hover) and (pointer: fine) {
  /* every :hover rule lives here */
}
```

Next.js App Router equivalent:

```ts
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};
```

Read the `theme-color` values from the project's tokens (the header background in each theme). Never invent them. A light-only app sets `color-scheme: light`, not `light dark`.

## Hover

Touch has no hover, so the browser fakes one: the first tap applies `:hover` and leaves it until the user taps elsewhere. A button that scales on hover stays scaled after a tap. Gate every hover style:

```css
@media (hover: hover) and (pointer: fine) {
  .button:hover {
    background: var(--gray-3);
    transform: scale(1.02);
  }
}
```

`(hover: hover)` means the primary input can hover; `(pointer: fine)` rules out styluses and devices that misreport hover. Tailwind v4's `hover:` variant already compiles to `@media (hover: hover)`. In Tailwind v3, set `future: { hoverOnlyWhenSupported: true }` in the config; that one line fixes every instance.

Nothing may be reachable through hover alone. A row action that appears only on hover does not exist on a phone. Hide it only inside the hover/pointer-fine query so coarse pointers always render it (at lower emphasis if needed), and also reveal it on `:focus-within` for keyboard users.

## Tap feedback

### Kill the tap highlight

iOS Safari and Android Chrome paint a translucent flash over anything with a click handler. It is the loudest "this is a website" signal and fights your own press state.

```css
html { -webkit-tap-highlight-color: transparent; }
```

Once it is gone, every tappable element needs its own `:active` state, because you removed the only feedback the browser gave.

### Respond on press, act on release

Native buttons respond the instant a finger lands. A web button that changes only on `click` responds when the finger lifts, which reads as lag.

```css
.button {
  transition: transform 150ms var(--ease-out), background-color 150ms;
}
.button:active {
  transform: scale(0.97);
  background: var(--gray-4);
}
```

- Feedback fires on press (`:active` or `pointerdown`); the action still fires on `click`, so the user can cancel by sliding off.
- Press feedback runs 100–160ms with `ease-out`. Never scale below `0.95`.
- Rows inside a scrolling list delay their pressed state ~100ms so a scrolling thumb does not light up every row it crosses. See [interaction-details.md](interaction-details.md).

### Remove the double-tap wait

Browsers may wait after a tap to see whether a second tap (double-tap zoom) follows. `width=device-width` removes it in most cases, not all. `touch-action: manipulation` tells the browser the element never double-tap-zooms, so `click` fires immediately (in the baseline above).

## Tap targets

A finger pad covers about 44px. The visual can stay small; the hit area cannot.

```css
.icon-button {
  position: relative;
  width: 24px;
  height: 24px;
}
.icon-button::before {
  content: "";
  position: absolute;
  inset: -10px; /* 24 + 10 + 10 = 44 */
}
```

Tailwind: `relative before:absolute before:-inset-2.5`. Alternatively `min-width: 44px; min-height: 44px` with centered content.

- Two hit areas never overlap. If an extended area collides with a neighbor, shrink both to the largest non-colliding size or add spacing.
- Checkbox and radio rows wrap control and text in one `<label>` so the gap between them is not a dead zone.
- Usual offenders: toast dismiss buttons, table row actions, pagination, close buttons in sheets.

## Viewport units

`100vh` on mobile is the largest viewport (browser chrome collapsed). On load the URL bar is visible, so a `100vh` element overflows and a bottom-pinned button sits under the bar.

```css
.app  { height: 100dvh; }      /* app shells, drawers, bottom-pinned UI: tracks the visible area */
.hero { min-height: 100svh; }  /* heroes and first screens: smallest viewport, stable, never cut off */
```

| Unit | Meaning | Use for |
| --- | --- | --- |
| `dvh` | Current visible height, changes as chrome shows/hides | App shells, full-height drawers, chat layouts |
| `svh` | Smallest height (chrome expanded) | Marketing heroes, first screens |
| `lvh` | Largest height, same as old `vh` | Almost never |

`dvh` on marketing content causes layout shift mid-scroll as the URL bar collapses; use `svh` there. Tailwind: `h-dvh`, `min-h-svh`. `h-screen` and `min-h-screen` are `100vh` and carry the bug. Also hunt for `calc(100vh - …)`. Desktop-only admin tools can keep `vh`.

## Safe areas

By default the browser letterboxes the page inside the safe area. Native apps paint edge to edge and pad their content away from the notch, Dynamic Island, and home indicator. Two steps, both required:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

```css
.app-header { padding-top: env(safe-area-inset-top); }
.bottom-bar { padding-bottom: env(safe-area-inset-bottom); }
.sheet      { padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px)); }
.sidebar    { padding-left: env(safe-area-inset-left); } /* landscape puts the notch on the side */
```

- Without `viewport-fit=cover` every `env()` value is `0`.
- Give `env()` a fallback (`env(safe-area-inset-bottom, 0px)`) inside `calc()`.
- Elements that need it: fixed and sticky headers, bottom tab bars, toasts and the toaster offset, sheets, floating action buttons, cookie banners.
- Normal page content gets it for free through the header's padding.

## Inputs

iOS Safari zooms the page when focus lands on an input under 16px and does not zoom back on blur.

```css
input, textarea, select { font-size: 16px; }
```

If desktop needs smaller inputs, make the small size the default and restore 16px on coarse pointers:

```css
input, textarea, select { font-size: 14px; }
@media (pointer: coarse) {
  input, textarea, select { font-size: 16px; }
}
```

Tailwind v4.1+: `text-base pointer-fine:text-sm`. `text-sm` alone on an input is the bug, and so is `md:text-sm`: an iPad is wide and still zooms. Check contenteditable editors too.

Set the right keyboard while you are there: `inputmode="numeric"` for codes, `inputmode="decimal"` for amounts, `type="email"` / `type="tel"`, `autocapitalize="none"` and `autocorrect="off"` on usernames and codes, `autocomplete="one-time-code"` so iOS offers the SMS code, and `enterkeyhint="send"` / `"search"` / `"done"` so the return key says what it does. Full form rules are in [forms.md](forms.md).

## Keyboard

The software keyboard takes roughly half the screen, and the platforms disagree about the layout. iOS shrinks the visual viewport and scrolls the focused input into view. Android Chrome, by default, overlays the keyboard on the page, so bottom-pinned composers and CTAs end up underneath.

### Android: resize the layout

`interactive-widget=resizes-content` in the viewport meta tag makes Android Chrome resize the layout viewport, so `100dvh` shrinks and a composer at the bottom of a `100dvh` flex column stays above the keyboard with no JavaScript.

### iOS: follow the visual viewport

iOS Safari ignores `interactive-widget` and never resizes the layout viewport. Lift bottom-pinned UI by the keyboard's height:

```js
const vv = window.visualViewport;
function update() {
  const offset = window.innerHeight - vv.height - vv.offsetTop;
  composer.style.transform = `translateY(${-Math.max(0, offset)}px)`;
}
vv.addEventListener("resize", update);
vv.addEventListener("scroll", update);
```

Always confirm this on a real iPhone.

### Fixed CTAs and the last field

A fixed bottom button covers the final form field and the home indicator. Pad the scroll container by the CTA height plus the safe area, and pad the CTA itself with `env(safe-area-inset-bottom)`:

```css
.form-scroll {
  padding-bottom: calc(var(--cta-height) + env(safe-area-inset-bottom, 0px));
}
```

### Never open the keyboard for the user

`autoFocus` on a touch device pops the keyboard the moment the screen appears and shoves the layout up before the user has read it. Autofocus on desktop only, in an effect so server and client renders agree:

```jsx
useEffect(() => {
  if (!window.matchMedia("(pointer: coarse)").matches) inputRef.current?.focus();
}, []);
```

## Scroll

### Overscroll and pull-to-refresh

Scrolling past the top triggers pull-to-refresh on Android and the whole-page rubber band on iOS. That is right on a document and wrong in an app shell with its own scroll containers, a draggable sheet, or a canvas.

```css
html, body { overscroll-behavior: none; }  /* app shells; skip on a document where pull-to-refresh is welcome */

.sheet-content {
  overflow-y: auto;
  overscroll-behavior: contain; /* keeps the container's own bounce, stops the page behind from moving */
}
```

`none` on the root, `contain` on inner scrollers (sheets, chat lists, sidebars, modals). Never use a `touchmove` + `preventDefault()` listener for this: it blocks scrolling and makes the listener non-passive, which costs frames.

### Custom pull-to-refresh

Only build one inside an app shell where the native one is disabled. Track the pull with a motion value 1:1 (with resistance past the threshold), trigger at a fixed distance (~64–80px), hold a spinner at that position while loading, and spring back on release. Start the gesture only when the scroller is at `scrollTop === 0`. On a plain scrolling page, let the browser do it.

### Momentum scrolling

Native scroll already has platform momentum. `-webkit-overflow-scrolling: touch` is obsolete (default since iOS 13); remove it. Never reimplement scroll physics with wheel or touch listeners; use native overflow plus `scroll-snap` when items need to land on positions.

### Scroll locking

When a modal or sheet is open, the page behind must not scroll. Use a dialog primitive that locks scroll (Base UI, Radix, Vaul). `overflow: hidden` on `body` alone has a long history of being ignored by iOS Safari for touch scrolling.

### Horizontal overflow

One element wider than the viewport makes the whole page pan sideways. Usual causes: a long URL or email in a card, `<pre>` blocks, wide tables, fixed pixel widths over ~340px, `100vw` on a page with a vertical scrollbar.

```css
.card-text { overflow-wrap: break-word; }
.table-wrap, pre { overflow-x: auto; }
```

Fix the element that overflows. `overflow-x: hidden` on `body` hides the symptom and breaks `position: sticky`.

## Long press

Holding a finger on a button selects its label on iOS; holding a link or image pops the copy/share callout. Native controls never do that. Control text is not selectable; content text must stay selectable.

```css
button, [role="button"], .tab, .chip, .drag-handle {
  user-select: none;
  -webkit-user-select: none;   /* Safari still needs the prefix */
  -webkit-touch-callout: none; /* no long-press callout on links/images used as controls */
}
```

Never put `user-select: none` on `body`, `*`, or a layout wrapper. Users copy addresses, error messages, and order numbers.

## Gesture axes

A horizontal swipe on a carousel is ambiguous to the browser, which often scrolls the page while the track moves. Declare which axes the browser keeps:

```css
.carousel     { touch-action: pan-y; }  /* you handle horizontal; browser keeps vertical scroll */
.sheet-handle { touch-action: pan-x; }  /* you handle vertical drags; browser keeps horizontal */
.drag-surface { touch-action: none; }   /* canvas, map, free 2D drag: you own every axis */
```

The value names what the browser may still do. `none` only on surfaces that own both axes, or the user cannot scroll past them. For a native-scroll carousel, prefer `scroll-snap-type: x mandatory` on the track and `scroll-snap-align: start` on slides; the browser's physics beat a hand-rolled spring and `touch-action` becomes unnecessary.

## Sheets and drawers

Bottom sheets are the native mobile pattern for secondary content and actions. Use a primitive (Vaul, or Base UI / Radix dialog with drag added) rather than hand-rolling focus, scroll lock, and drag together.

- **Enter from the edge it lives on** with `translateY(100%)`, so the distance matches the sheet's own height. Easing `cubic-bezier(0.32, 0.72, 0, 1)`; ~500ms is acceptable for a full-height sheet on this curve because it front-loads the movement, 200–300ms for smaller sheets.
- **Exit the way it came**, faster than the entrance.
- **Drag to dismiss.** Track the finger 1:1 with a motion value, not a spring. Dismiss past a distance threshold (~25% of the sheet's height) or on a fast flick regardless of distance. Otherwise spring back. Release into a spring that inherits the gesture velocity. Details in [animation-gestures-scroll.md](animation-gestures-scroll.md).
- **Scroll vs drag.** When the sheet's content scrolls, dragging down drags the sheet only when the content is at `scrollTop === 0`; otherwise it scrolls the content. Inner content gets `overscroll-behavior: contain`.
- **Dampen upward drag** past the open position instead of stopping hard, so it feels like rubber, not a wall.
- **Snap points** for multi-height sheets: snap to the nearest point on release, weighted by velocity.
- **Padding** at the bottom includes `env(safe-area-inset-bottom)`. Height uses `dvh` (`max-height: 90dvh`) so it tracks the URL bar and the keyboard.
- **Show a drag handle** (a short pill at the top) when the sheet is draggable; it is the affordance users look for.
- **Scale the page behind** slightly (iOS-style) only when the sheet is a full modal; never on a non-modal sheet.

## Bottom navigation

- 3–5 top-level destinations, each with an icon and a short label. Icons alone are ambiguous.
- Fixed to the bottom with `padding-bottom: env(safe-area-inset-bottom)`; the tappable area sits above the home indicator. Reserve its height in the scroll container so content is not hidden beneath it.
- Switching tabs is instant: no transition, no page-slide animation. It is a high-frequency action.
- The active state uses color or a filled icon, never a font-weight change (the label reflows).
- Preserve each tab's scroll position and state when switching back. Tapping the already-active tab scrolls its view to the top (iOS convention).
- Hide or keep it out of the way when the keyboard is open, so it does not ride up on top of the keyboard on Android.

## Platform conventions

- **Edge swipes belong to the OS.** iOS uses the left edge for back navigation and the bottom edge for the home gesture; Android uses both side edges for back. Don't start custom horizontal drags in the outer ~20px of the screen.
- **Android Back closes overlays.** A full-screen sheet or modal should push a history entry when it opens so the system Back gesture closes it instead of leaving the page. Popping the entry on close keeps history clean.
- **Pull-to-refresh** belongs to documents and feeds. Disable it in app shells; build a custom one only when the screen needs refresh (see Scroll).
- **Action sheets for destructive choices on mobile**: a bottom sheet with the destructive option clearly labeled and a separate Cancel, rather than a centered desktop dialog.
- **Tap highlights, long-press callouts, text selection on controls, and hover states** are the four tells that most often give a web app away; the baseline removes the first three, the hover gate the fourth.

## Haptics

- `navigator.vibrate()` works on Android Chrome only; iOS Safari does not support it. Always feature-detect and treat haptics as an enhancement.
- On iPhone, the native switch control (`<input type="checkbox" switch>`, Safari 17.4+) gives a system haptic on recent iOS versions, and is the only reliable path to one from web content. Use it for real toggles; do not hack it for unrelated feedback.
- Use haptics sparingly: confirming a completed drag-to-dismiss, a snap point, a long-press trigger, a destructive confirmation. Keep pulses short (10–20ms). Never vibrate on every tap or on scroll.
- Never pair a haptic with an action the user did not cause.

## Video

Without `muted`, iOS refuses to autoplay. Without `playsinline`, it opens the fullscreen player.

```html
<!-- no autoplay attribute: start it from script after the reduced-motion check -->
<video muted playsinline loop>
  <source src="video.mp4" type="video/mp4" />
</video>
```

Under `prefers-reduced-motion: reduce`, don't autoplay; show controls. Leave the `autoplay` attribute off and call `play()` in an effect after checking `matchMedia`, since the server can't know the preference. Pause videos that scroll out of view with an `IntersectionObserver`; a looping video below the fold drains battery. See [animation-performance-accessibility.md](animation-performance-accessibility.md).

## Browser chrome

The status bar and browser UI take their color from `theme-color`. One value means light mode gets a dark bar or dark mode gets a white one.

```html
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a0a0a" />
```

- Match the color at the very top of the page (the header background), not the brand color.
- If the app toggles theme with a class rather than the OS setting, update the tag from JavaScript on toggle.
- `color-scheme` on the root makes native scrollbars, form controls, and autofill match.

## Sticky headers

An in-page link scrolls its target to the top of the viewport, exactly where the sticky header sits.

```css
[id] { scroll-margin-top: 64px; } /* the sticky header's real height; read it from the code */
```

Cap the sticky header's height. An 80px header on a 667px phone in landscape leaves almost no content. Consider hiding it on scroll down and revealing it on scroll up for content-heavy pages.

## PWA basics

When the app will be installed to the home screen:

```json
{
  "name": "Product",
  "short_name": "Product",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#ffffff",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

```html
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" /> <!-- 180×180; without it iOS uses a page screenshot -->
```

- `name`, `short_name`, and icons are the product's, never framework defaults. Read colors from tokens.
- Maskable icons keep the logo inside the central safe zone (~80% of the canvas) so Android's mask does not crop it.
- In standalone mode there is no browser back button or URL bar. Every screen needs its own way back, and `100dvh` equals the full screen. Detect it with `@media (display-mode: standalone)` when the layout must differ.
- With `viewport-fit=cover` in standalone mode on iOS, content runs under the status bar; the header's `env(safe-area-inset-top)` padding is mandatory, not optional.
- Test the installed app separately; standalone mode changes viewport, safe areas, and status-bar behavior.

## Testing on hardware

- Run the dev server on `0.0.0.0` and open it on the phone by the machine's LAN IP.
- iOS: Safari → Develop → the device. Android: `chrome://inspect`.
- Test on a phone a few years old, with the keyboard open, and once in landscape.
- The iOS Simulator is better than emulation but still misses touch feel. Real hardware is the bar.
- Report device checks concretely: "open the drawer on an iPhone and confirm the bottom padding clears the home indicator", "open the keyboard on an iPhone and confirm the composer stays above it".

## Never ship

| Never | Instead |
| --- | --- |
| `user-scalable=no` or `maximum-scale=1` | 16px inputs, which fix the cause |
| Ungated `:hover` | `@media (hover: hover) and (pointer: fine)` |
| An action reachable only through hover | Always rendered on coarse pointers; revealed on `:focus-within` for keyboards |
| `100vh` / `h-screen` on an app shell or bottom-pinned UI | `100dvh` |
| `100dvh` on a marketing hero | `100svh` |
| Press feedback on `click` only | `:active` / `pointerdown` |
| A 24px hit area on a 24px icon | Pseudo-element out to 44px, never overlapping a neighbor |
| `touchmove` + `preventDefault()` to stop overscroll | `overscroll-behavior` |
| `overflow: hidden` on `body` as the only scroll lock | A dialog primitive that locks scroll |
| `user-select: none` on `body` | Only on controls |
| `touch-action: none` on something the user must scroll past | `pan-x` / `pan-y` |
| `env(safe-area-inset-*)` without `viewport-fit=cover` | Add the meta tag, or the value is `0` |
| `autoFocus` with no pointer gate | Desktop only, via `(pointer: coarse)` |
| Autoplay video without `muted playsinline` | Both attributes, and no autoplay under reduced motion |
| One `theme-color` for both schemes | One per `prefers-color-scheme` |
| `overflow-x: hidden` on `body` to hide sideways panning | Fix the overflowing element |
| User-agent sniffing to detect touch | `(hover)` / `(pointer)` media queries |
| Declaring it fixed from device emulation | Real hardware |

## Checklist

- [ ] Viewport meta has `viewport-fit=cover` and `interactive-widget=resizes-content`, and never `maximum-scale` / `user-scalable`
- [ ] Every `:hover` is gated behind `(hover: hover) and (pointer: fine)`; nothing is hover-only
- [ ] Tap highlight removed and every control has an `:active` state (`scale(0.97)`, 100–160ms)
- [ ] `touch-action: manipulation` on controls; tap targets reach 44px without overlapping
- [ ] App shells use `dvh`, heroes use `svh`; no `100vh` / `h-screen` on mobile layouts
- [ ] Fixed headers, bottom bars, sheets, and toasts pad with `env(safe-area-inset-*)`
- [ ] Inputs are 16px on coarse pointers, with the right `type`, `inputmode`, `autocomplete`, and `enterkeyhint`
- [ ] Keyboard never covers the composer or CTA (Android resize, iOS `visualViewport`); no autofocus on touch
- [ ] `overscroll-behavior: none` on app-shell roots, `contain` on inner scrollers; scroll locked under modals by a primitive
- [ ] Controls aren't selectable, content is; gesture surfaces declare their axis with `touch-action`
- [ ] `theme-color` per scheme matches the header; nothing scrolls sideways at 375px
- [ ] Verified on a real phone, keyboard open, once in landscape
