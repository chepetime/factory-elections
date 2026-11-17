# Review Checklist

The consolidated pre-ship and UI review checklist across every category in this skill. Use it when reviewing a diff, a generated component, a pull request, or a whole app before launch. Each line is a terse, checkable rule; the linked category file holds the reasoning, exact snippets, and edge cases. Default to flagging: code that renders but feels off is a regression, not a pass.

## How to review

### Order

Read the whole diff first, then check in this order. The order is the triage order: a broken interaction outranks a soft shadow.

1. **Interaction correctness**: every control works with mouse, keyboard, and touch.
2. **Accessibility floor**: names, focus, contrast, reduced motion, tap targets.
3. **Layout stability**: nothing shifts on load, on data, or on interaction.
4. **Motion**: justified, frequency-appropriate, fast, strong easing, GPU-only, interruptible.
5. **Mobile**: viewport, safe areas, keyboard, hover gating, input zoom.
6. **Forms and states**: submission, errors, loading, empty, failure.
7. **Spacing and hierarchy**, then **typography**, then **color and surfaces**.
8. **Component API**, only when the diff introduces a shared component.
9. **Performance**: lists, images, fonts, render storms.
10. **Polish**: selection, scrollbars, characters, copy.
11. **Marketing**, only on public pages: metadata, OG, motion restraint, real proof.

### Severity

Walk this top to bottom and stop at the first yes:

```
Does it exclude a group of users outright (keyboard, screen reader,
low vision, motion-sensitive, touch)?
├── Yes → BLOCKER
└── No
    Will a typical user hit it in their first session, on any device?
    ├── Yes → BLOCKER
    └── No
        Does it leak something (secrets, debug output, dev tools, fake content)?
        ├── Yes → BLOCKER
        └── No
            Is it visible on the wrong device, theme, network, or data
            state, and invisible on the dev machine?
            ├── Yes → SHOULD FIX
            └── No → POLISH
```

Context overrides defaults: a missing `alt` on the only product image is a blocker; `100vh` on a desktop-only admin tool is nothing.

### Report format

Lead with the verdict, then findings grouped by severity. Don't bury the one thing that matters under ten nits.

- **Verdict**, one line: **Blocked** (at least one blocker), **Approve with changes**, or **Ship it**.
- **Findings**, one row each, sorted by severity:

| Severity | Where | Issue | Fix |
| --- | --- | --- | --- |
| BLOCKER | `Dialog.tsx:41` | `<button><CloseIcon /></button>` has no accessible name | `aria-label="Close dialog"` |
| SHOULD FIX | `Dropdown.tsx:18` | `transition: all 400ms ease-in` | `transition: opacity 200ms, transform 200ms cubic-bezier(0.23, 1, 0.32, 1)` |
| POLISH | `Stats.tsx:14` | Counter digits shift width as they change | `font-variant-numeric: tabular-nums` |

- **Needs a device**: what code can't prove, with what to look for ("open the drawer on an iPhone and confirm the bottom padding clears the home indicator").

Rules for findings:

- Cite `file:line` and the exact current value. "The drawer is too slow" is weak; "the drawer uses `500ms ease-in-out`; use ~250ms with `cubic-bezier(0.32, 0.72, 0, 1)`" is a review.
- Re-read the cited code before reporting. Never present a finding you haven't confirmed.
- Pull exact values from the category files; never approximate a curve, duration, or threshold.
- One root cause with many instances (forty ungated `:hover` rules) is one row with a count, fixed at the root.
- Defects, not taste. A finding names what breaks and for whom.
- Respect documented trade-offs: a comment recording a deliberate decision is noted, not flagged.
- A clean "Ship it" is a valid result. Manufacturing nits to look thorough wastes the reader's trust.

### Fix preference for motion

Prefer earlier moves over later ones: (1) delete the animation, (2) reduce it, (3) fix the easing, (4) fix origin and scale values, (5) make it interruptible, (6) move it to `transform`/`opacity`, (7) make timing asymmetric, (8) polish (blur-masked crossfade, varied stagger), (9) add reduced-motion and hover gating, unify timing.

### Do not flag

- `transform-origin: center` on a modal. Modals appear centered.
- `linear` on a marquee, spinner, timer, progress bar, hold-to-delete, or continuous rotation.
- Built-in `ease` on a hover, color, background, or opacity change.
- The fast `ease-out` snap-back on releasing a hold.
- Long durations or one-shot intros on marketing pages.
- A ~500ms full-height sheet on a curve as steep as `cubic-bezier(0.32, 0.72, 0, 1)`.
- `@keyframes` on an infinite loop or an intro that runs once.
- Tailwind v4 `hover:` classes without a hover media query; the variant already includes it.
- `user-select: none` on a button; `console.error` in an error boundary; `100vh` on a desktop-only tool.

## Flag on sight

- `transition: all` or Tailwind `transition-all`
- `scale(0)` entrances
- `ease-in` on an entrance, hover, or press
- Animation on a keyboard shortcut, command palette, arrow-key navigation, or 100+/day action
- Animating `width` / `height` / `margin` / `padding` / `top` / `left`
- Icon-only button with no accessible name
- `outline: none` with no `:focus-visible` replacement
- `<div onClick>` doing a button's job
- Core action reachable only on hover
- Input under 16px on coarse pointers; `user-scalable=no` or `maximum-scale=1`
- `100vh` / `h-screen` on an app shell
- Dynamic number without `tabular-nums`; font weight changing on hover or selection
- `z-index: 9999` or any ad-hoc large z-index
- Unbounded list, or one that can pass 200 rows, without virtualization
- Movement with no `prefers-reduced-motion` handling
- `console.log`, lorem ipsum, fabricated stats or testimonials, dev tools mounted in production

## Animation

Depth: [animation-principles.md](animation-principles.md), [animation-css.md](animation-css.md), [animation-motion-react.md](animation-motion-react.md), [animation-gestures-scroll.md](animation-gestures-scroll.md), [animation-performance-accessibility.md](animation-performance-accessibility.md)

- [ ] Every animation has a one-sentence purpose: feedback, spatial continuity, state change, preventing a jarring jump, explanation
- [ ] Keyboard-initiated and 100+/day actions don't animate; cursor- and arrow-key highlights are instant
- [ ] Entrances and exits use `ease-out` or a strong custom curve; on-screen moves use `ease-in-out`; hover/color uses `ease`; `linear` only for constant motion
- [ ] Deliberate animations use a custom cubic-bezier, not a weak built-in
- [ ] Product UI stays under 300ms: press 100–160ms, hover 100–150ms, tooltips 125–200ms, dropdowns 150–250ms, modals and drawers 200–300ms; page transitions up to 400ms
- [ ] Exits are shorter and simpler than entrances (~20–30% faster)
- [ ] Entrances start from `scale(0.95)` (`0.97` for small elements) plus opacity, never `scale(0)`; travel stays 8–16px unless coming from off-screen
- [ ] Popovers, dropdowns, and tooltips scale from their trigger via `transform-origin`; modals stay centered
- [ ] Press is `scale(0.97)`, never below `0.95`; hover scale is 1–2%
- [ ] Hover lift moves a child, not the hovered element (no flicker loop)
- [ ] Toggled and rapidly retriggered UI (toasts, drawers, accordions) uses transitions or springs, not `@keyframes`
- [ ] Gestures track input 1:1 with a motion value and release into a spring carrying the velocity
- [ ] Springs default to `bounce: 0`; bounce only where a drag applies force or the brand calls for it
- [ ] Paired elements (modal + backdrop, drawer + overlay) share duration and easing; a component's sub-animations read as one
- [ ] Exit direction matches entry; forward moves left, back moves right
- [ ] Exits actually play (`AnimatePresence` ancestor with a keyed child)
- [ ] Nothing at rest animates on page load (`initial={false}` on toggles, tabs, icon swaps)
- [ ] Stagger 30–80ms per item, total under ~400ms; varied by importance; one entrance per container
- [ ] Only `transform`, `opacity`, `filter`, `clip-path` animate continuously
- [ ] Animated blur stays at or under 20px (2–5px masks a crossfade)
- [ ] No React state updates per frame; no parent CSS variable driving child transforms
- [ ] Motion that runs while the page is busy uses CSS/WAAPI or a `transform` string
- [ ] Layout animations use inline pixel `borderRadius`; height animates to a measured value
- [ ] Reduced motion keeps opacity and color, drops movement; no blanket `animation: none !important`
- [ ] Autoplay, loops, and smooth scroll are disabled or paused under reduced motion
- [ ] `will-change` only where a hitch was observed

## Visual design

Depth: [design-foundations.md](design-foundations.md)

- [ ] Spacing comes from the scale; no one-off values
- [ ] `gap` on the parent instead of margins on children
- [ ] Edges align; optical alignment wins when it disagrees with math (play icons, chevrons)
- [ ] One primary action per view; secondary actions are visibly quieter
- [ ] Restraint: few borders, few shadows, few competing focal points
- [ ] Containers cap at a max width; breakpoints sit where content breaks, not at device widths
- [ ] One icon library, consistent stroke and size; 6–8px between icon and label
- [ ] Icons that carry meaning have a label; one icon never means two things
- [ ] Empty states have a headline, one line of explanation, and the action that creates the first item
- [ ] Error states say what happened and offer a specific recovery
- [ ] Labels are specific ("Save changes", not "Submit"); sentence case; front-load the important word

## Typography

Depth: [typography.md](typography.md)

- [ ] Sizes come from a small type scale
- [ ] Body line length caps around 65ch (60–75); body leading 1.5–1.6, headings ~1.1
- [ ] Headings use `text-wrap: balance`; paragraphs use `text-wrap: pretty`
- [ ] Large headings have slight negative tracking; small uppercase labels slight positive tracking
- [ ] Changing numbers, prices, and table columns use `tabular-nums`
- [ ] `font-synthesis: none`; every weight and italic used is actually loaded
- [ ] Fonts are `woff2`, subset, only the weights used, preloaded with `crossorigin`
- [ ] Fallback stack has matched metrics, so the swap doesn't shift layout
- [ ] Real characters: `…`, curly quotes, `×`, `–` for ranges (not in code)
- [ ] Uppercase via `text-transform`, not typed in caps
- [ ] `-webkit-font-smoothing: antialiased` on body (macOS)
- [ ] Underline only on links

## Color

Depth: [color.md](color.md)

- [ ] Body text meets 4.5:1; large text and UI components 3:1; checked in both themes against the real background
- [ ] Contrast fixed by moving the foreground's lightness, not by raising chroma
- [ ] Colors come from semantic tokens, not raw hex or palette classes in components
- [ ] Neutrals are slightly tinted toward the brand hue, not pure gray
- [ ] Tints and hovers are built in OKLCH (or `color-mix`), not by lowering opacity
- [ ] Disabled states use a muted token, not `opacity`
- [ ] Errors use color plus an icon plus a message
- [ ] Success color is distinct from the brand/primary color
- [ ] Brand color is desaturated for dark mode; pure `#000` / `#fff` are rarely right
- [ ] Single-theme apps declare `color-scheme` for that theme only

## Surfaces

Depth: [surfaces.md](surfaces.md)

- [ ] Shadows and borders form one elevation system, not a grab-bag
- [ ] Nested radii are concentric: inner = outer − padding
- [ ] Borders use alpha colors so they recede (e.g. `rgba(0,0,0,0.08)`)
- [ ] Layered shadows instead of one heavy drop shadow
- [ ] Dark mode is a designed surface set: lighter surfaces read as closer; shadows become low-opacity white rings
- [ ] Images get a 1px outline at 10% black (light) / 10% white (dark), never tinted
- [ ] Gradients are smooth (no banding or hard stops)
- [ ] `z-index` comes from a small scale or `isolation: isolate`
- [ ] Custom scrollbars only inside small scoped elements, never the page

## Interaction

Depth: [interaction-details.md](interaction-details.md)

- [ ] Everything works with the keyboard: Tab reaches it, Enter/Space activates, Escape dismisses, arrows move within menus and lists
- [ ] Focus is trapped only in modals and returns to the trigger on close
- [ ] Press feedback on `:active` / `pointerdown`; the action fires on release
- [ ] Rows in scrolling lists delay pressed state ~100ms
- [ ] Tooltips wait ~500ms on first hover; subsequent tooltips open instantly with no animation
- [ ] Tooltips hold no interactive content; use a click-triggered popover instead
- [ ] Toasts stay 4000ms (6000ms with an action), pause on hover, focus, and hidden tab
- [ ] Copy buttons confirm with a checkmark for ~1.5s
- [ ] Optimistic updates revert and say so on failure
- [ ] Shortcuts show the right modifier per platform (`⌘` vs `Ctrl`)
- [ ] Sliders update live while dragging
- [ ] Destructive actions confirm with a dialog (not `window.confirm()`) or offer undo; the confirm button names the outcome
- [ ] Every wait over 400ms has an indicator; indicators delay ~150ms so fast responses never flash one
- [ ] Skeletons hold the loaded content's exact shape; spinners only inside controls

## Forms

Depth: [forms.md](forms.md)

- [ ] Inputs live in a `<form onSubmit>`; Enter submits; textareas submit on Cmd/Ctrl+Enter
- [ ] Buttons inside forms have an explicit `type`
- [ ] Every input has an associated `<label>`; placeholder is never the label
- [ ] Submit disables while pending and says what's happening ("Saving…"), keeping a stable width
- [ ] A failed submit keeps every value, re-enables the button, and shows what happened
- [ ] Validation runs on blur or submit, then on change once an error is shown
- [ ] Errors sit under their field, wired with `aria-describedby` and `aria-invalid`, and name the fix
- [ ] Focus moves to the first invalid field after a failed submit
- [ ] Correct `type`, `autocomplete`, `inputmode`, and `enterkeyhint`; `spellcheck="false"` on codes and slugs
- [ ] Checkbox and radio rows have no dead zones (one wrapping `<label>`)
- [ ] Input decorations sit over the real input with padding; non-interactive ones have `pointer-events: none`
- [ ] Known values are prefilled; long forms survive refresh or warn on leave

## Touch & accessibility

Depth: [touch-accessibility.md](touch-accessibility.md)

- [ ] Icon buttons have an `aria-label` naming the action ("Search", not "icon"); decorative icons are `aria-hidden`
- [ ] Buttons are `<button>`, links are `<a href>`; no positive `tabindex`
- [ ] `:focus-visible` outline, 2px with `outline-offset: 2px`, neutral color, not clipped by `overflow: hidden`
- [ ] Modals use a dialog primitive: focus moves in, is trapped, Escape closes, focus returns
- [ ] Closed drawers, menus, and collapsed panels are out of the tab order (`inert` or `visibility: hidden`)
- [ ] Focus never drops to `<body>` after a removal; focused elements scroll into view
- [ ] DOM order matches visual order
- [ ] One `<h1>`, no skipped heading levels, `<main>`, `<html lang>`, a skip link on long navigation
- [ ] Async results, toasts, and errors are announced via live regions that exist before the message
- [ ] Countdowns pause when the tab is hidden
- [ ] Tap targets reach 44×44px
- [ ] Hover enhances, never enables

## UI polish

Depth: [ui-polish.md](ui-polish.md)

- [ ] No layout shift: media has dimensions, async content has reserved space, late banners overlay
- [ ] Persisted state (theme, sidebar, tabs) is correct on first paint; no flash on refresh
- [ ] Theme switches don't animate every color (`disableTransitionOnChange`)
- [ ] Long content is handled: truncation with `min-width: 0`, `line-clamp`, `overflow-wrap`, and a way to read the rest
- [ ] Decorative layers have `pointer-events: none`; code-built illustrations have `user-select: none`
- [ ] Custom `::selection` where the default clashes, legible in both themes
- [ ] `scroll-margin-top` equals the sticky header's height
- [ ] Generated-looking tells removed: gradient headline text, glass over nothing, emoji feature grids, fade-in on every section

## Component design

Depth: [component-design.md](component-design.md)

- [ ] Composition (children, compound parts) over a wall of boolean props
- [ ] Controlled and uncontrolled modes when the component holds state
- [ ] Refs forwarded and remaining props spread onto the root element
- [ ] Props named for intent; the common case is a one-liner; event handlers named `on*`
- [ ] Hard to misuse: no easy-to-forget required props, no footguns
- [ ] Built on an accessible primitive (Base UI, Radix) rather than hand-rolled focus and keyboard logic

## Performance

Depth: [performance.md](performance.md)

- [ ] Lists that are unbounded or can pass 200 rows are virtualized
- [ ] Images are sized to display, lazy below the fold, hero preloaded; WebP/AVIF for photos
- [ ] No `transition: all`; named properties only
- [ ] Search inputs debounce ~300ms and abort stale requests; scroll listeners are passive
- [ ] Heavy, rarely seen UI (editors, charts, highlighters) is code-split with a sized fallback
- [ ] Off-screen loops, video, canvases, and polling pause
- [ ] Content routes are static with revalidation
- [ ] Nothing dev-only (inspectors, control panels, devtools) ships in the bundle
- [ ] Verified on a mid-range phone and a production build, not the dev server

## Mobile

Depth: [mobile.md](mobile.md)

- [ ] Viewport meta: `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content`; never disables zoom
- [ ] `:hover` gated behind `(hover: hover) and (pointer: fine)`
- [ ] Tap highlight removed; every control has `:active`; `touch-action: manipulation`
- [ ] App shells use `100dvh`; heroes `100svh`
- [ ] Fixed headers, bottom bars, sheets, and toasts pad with `env(safe-area-inset-*)`
- [ ] Inputs are 16px on coarse pointers (`text-base pointer-fine:text-sm`, never `md:text-sm`)
- [ ] Keyboard never covers the composer or the last field; no autofocus on touch
- [ ] `overscroll-behavior: none` on app-shell roots, `contain` on inner scrollers; no `touchmove` `preventDefault`
- [ ] Controls not selectable, content selectable; gesture surfaces declare `touch-action` axes
- [ ] Video is `muted playsinline`; no autoplay under reduced motion
- [ ] `theme-color` per scheme; nothing scrolls sideways at 375px
- [ ] Sheets dismiss by drag or flick, respect inner scroll, and close on Android Back

## Marketing

Depth: [marketing.md](marketing.md)

- [ ] No scroll-triggered section reveals, scroll hijacking, non-1:1 parallax, or auto-advancing carousels
- [ ] Content is visible without JS; intros play once per session, gated before paint
- [ ] Every stat, testimonial, and logo is real
- [ ] Pricing matches billing config; no test-mode payment links; conversion path works end to end
- [ ] CTAs reflect auth state, resolved on the client
- [ ] Nav submenu content is in the DOM when closed
- [ ] Every route has a title, description, and 1200×630 OG image; `metadataBase` set
- [ ] `robots` and `sitemap` correct; no leftover `noindex` or `Disallow: /`; real favicon and `apple-touch-icon`
- [ ] Docs snippets have confirming copy buttons; pages export as markdown
- [ ] RSS for blog and changelog

## Leftovers

- [ ] No lorem ipsum, "John Doe", `example.com`, `href="#"`, or framework default titles and favicons
- [ ] No `console.log`, `debugger`, or `alert(` (logging in error boundaries is fine)
- [ ] No secrets behind `NEXT_PUBLIC_` / `VITE_`, no `localhost` URLs in client code
- [ ] Dev tools and control panels gated on `NODE_ENV === "development"` with a dynamic import
- [ ] `/proto`, `/lab`, `/test`, `/playground` routes gated out of production
- [ ] Commented-out code removed; `TODO`s on auth, payment, and deletion paths reported verbatim

## Verify by hand

Code proves attributes exist. It can't prove these; list them as checks to run, never as verified.

- Unplug the mouse and complete the main flow with Tab, Enter, Escape, and arrows.
- Listen to the main screen with VoiceOver or NVDA.
- Open on a real phone: keyboard open, once in landscape, sheets and bottom bars against the home indicator.
- Sign up with a fresh account and look at every screen before adding data.
- Go offline and throttle the network; watch what each view shows.
- Switch to the other theme and visit every route, modal, dropdown, and toast.
- Slow animations to 10% in DevTools and watch each enter and exit for a jump at the start or end.
- Paste public URLs into Slack and iMessage and check the previews.

## Checklist

- [ ] Read the whole diff before judging any line
- [ ] Checked categories in triage order, interaction and accessibility first
- [ ] Every finding has `file:line`, the current value, the issue, and an exact fix
- [ ] Severity assigned with the decision tree, context applied
- [ ] Do-not-flag list checked before writing each row
- [ ] One row per root cause, with an instance count
- [ ] Verdict line first: Blocked, Approve with changes, or Ship it
- [ ] Device and human checks listed separately, never claimed as verified
