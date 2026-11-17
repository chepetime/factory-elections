---
name: emil-design-engineering
description: "Design engineering judgment for building polished, accessible web interfaces: animation, visual design, typography, color, surfaces, interaction details, forms, touch and accessibility, component APIs, performance, mobile, and marketing pages. Use when building, styling, animating, or reviewing any UI; when a component feels off, cheap, janky, or unfinished; or before shipping a page. Triggers on: design engineering, UI, UX, polish, animation, motion, transition, easing, cubic-bezier, spring, duration, Framer Motion, motion/react, AnimatePresence, layoutId, CSS animation, keyframes, clip-path, drag, gesture, swipe, scroll animation, parallax, reduced motion, typography, font, line-height, letter-spacing, tabular-nums, color, palette, oklch, contrast, dark mode, shadow, border, border-radius, gradient, spacing, hierarchy, layout, empty state, microcopy, hover, tooltip, popover, dropdown, menu, modal, drawer, sheet, toast, button, input, form, validation, focus, keyboard, aria, a11y, touch, tap target, iOS Safari, mobile, safe area, layout shift, z-index, scrollbar, component API, compound components, virtualization, preloading, performance, landing page, docs, changelog, design review, feels off, make it feel better."
---

# Emil's Design Engineering

Judgment and patterns for interfaces that feel fast, finished, and considered. Each category below has its own file with rules, values, code, and a checklist. Read the file for the area you're working in before writing code, and read more than one when a task crosses areas (a drawer touches animation, gestures, touch, and mobile).

## Match the project first

Before applying any rule, check how the project styles and animates things (Tailwind, CSS Modules, CSS-in-JS, plain CSS; Motion or CSS only; Radix or Base UI) and express every fix in that system. Reuse existing tokens, components, and primitives instead of adding parallel ones. A correct rule written in the wrong system is still a regression.

## Categories

### Animation

| File | Read when |
| --- | --- |
| [animation-principles.md](animation-principles.md) | Deciding whether to animate, picking easing, duration, springs, origin; enter/exit for modals, popovers, toasts, drawers, buttons |
| [animation-css.md](animation-css.md) | Writing transitions, keyframes, transforms, `clip-path`, `@starting-style`, stagger, hover effects, SVG line drawing |
| [animation-motion-react.md](animation-motion-react.md) | Using `motion/react`: exits, `AnimatePresence`, layout and shared-element animation, motion values; choosing a library |
| [animation-gestures-scroll.md](animation-gestures-scroll.md) | Drag, swipe-to-dismiss, momentum, rubber-banding; scroll reveals, scroll-driven animation, parallax |
| [animation-performance-accessibility.md](animation-performance-accessibility.md) | Jank and dropped frames, which properties to animate, reduced motion, diagnosing motion that feels off |

### Visual design

| File | Read when |
| --- | --- |
| [design-foundations.md](design-foundations.md) | Hierarchy, spacing, layout, navigation, icons, empty states, UI copy, avoiding generic-looking design |
| [typography.md](typography.md) | Fonts and loading, type scale, leading, tracking, line length, wrapping, truncation, OpenType features |
| [color.md](color.md) | Building palettes and scales, semantic tokens, contrast, P3, dark mode colors |
| [surfaces.md](surfaces.md) | Shadows, borders, radii, elevation, gradients, fades, dark mode surfaces, theme switching |

### Interaction

| File | Read when |
| --- | --- |
| [interaction-details.md](interaction-details.md) | Hover intent, tooltip and menu timing, popovers and dropdowns, press feedback, keyboard shortcuts |
| [forms.md](forms.md) | Inputs, labels, validation, submission, button states, autofill, selects and toggles |
| [touch-accessibility.md](touch-accessibility.md) | Tap targets, hover vs touch, keyboard navigation, focus management, ARIA, screen readers, iOS quirks |

### Building

| File | Read when |
| --- | --- |
| [ui-polish.md](ui-polish.md) | Layout shift, interaction states, hit areas, z-index, scrollbars, loading/empty/error states, ship hygiene |
| [component-design.md](component-design.md) | Designing a component API: composition, compound components, controlled state, customizability |
| [performance.md](performance.md) | Virtualization, preloading, images, bundle size, re-renders, perceived speed |
| [mobile.md](mobile.md) | Mobile web and native feel: viewport units, safe areas, sheets, keyboard, overscroll |
| [marketing.md](marketing.md) | Landing pages, pricing, blogs, docs, changelogs, OG images, metadata |
| [review-checklist.md](review-checklist.md) | Reviewing UI code or doing a pre-ship pass across every category |

## Core principles

These hold across every category. The files explain each one in depth.

1. **Speed over delight in product UI.** Interfaces people use all day should feel instant. Skip animation on actions repeated many times a day and on keyboard-triggered actions. Keep UI motion under 300ms. Marketing pages can be more expressive.
2. **Every animation has a reason.** If you can't say in one sentence why something moves (spatial continuity, feedback, explaining a change of state), it shouldn't move. When everything animates, nothing stands out.
3. **Motion should feel physical.** Use custom ease-out curves for entering and exiting, never `linear` for UI and never `ease-in` for responsive UI. Nothing appears from `scale(0)`. Animate from the trigger's origin. Make animations interruptible.
4. **No layout shift.** Reserve space for dynamic content, use `tabular-nums` for changing numbers, never change font weight on hover or selection, give images dimensions.
5. **Touch first, hover enhanced.** Gate hover effects behind `@media (hover: hover) and (pointer: fine)`, keep tap targets at 44px or larger, and never hide core functionality behind hover.
6. **Accessible by default.** Every animation has a reduced-motion variant. Every icon button has a label. Focus is always visible and managed when content opens and closes. Everything works with a keyboard.
7. **Animate only `transform` and `opacity` where possible.** Layout properties cost frames. Never write `transition: all`.
8. **Details compound.** Users rarely notice any single detail. They notice when an interface as a whole feels cheap or expensive, and that comes from getting dozens of small things right.

## Quick decisions

### Should this animate?

```
How often will people see it?
├── Many times a day, or triggered by keyboard → Don't animate
├── Occasionally (modals, drawers, toasts, menus) → Animate, ease-out, 150–300ms
└── Rarely (onboarding, marketing, celebrations) → Room for more expressive motion
```

### Which easing?

```
Entering or exiting? → ease-out (custom curve)
Moving or morphing on screen? → ease-in-out
Hover or color change? → ease
Follows a gesture or needs to be interruptible mid-flight? → spring
Constant motion (marquee, spinner, progress)? → linear
```

### CSS or a library?

```
Enter/exit, hover, simple transitions → CSS (with data-state / @starting-style)
Exit after unmount, layout or shared-element animation, real springs → motion/react
Drag-to-dismiss sheet → Vaul
Toasts → Sonner
```

## Common mistakes

| Mistake | Fix |
| --- | --- |
| `transition: all` | List the exact properties |
| `ease-in` or default `ease` on a dropdown | Custom ease-out curve |
| Entering from `scale(0)` | Start from `scale(0.95)` with `opacity: 0` |
| Animation on a keyboard-triggered action | No animation |
| Popover scales from its center | Set `transform-origin` to the trigger side |
| Animating `height`, `width`, `top`, `left` | `transform` and `opacity`, or measure and animate once |
| Hover effects firing on touch | `@media (hover: hover) and (pointer: fine)` |
| Font weight change on hover or selected tab | Constant weight, change color |
| Numbers jiggle as they update | `font-variant-numeric: tabular-nums` |
| `z-index: 9999` | A fixed z-index scale and `isolation: isolate` |
| Inputs under 16px | 16px minimum so iOS doesn't zoom |
| Icon button without a label | `aria-label` |
| No reduced-motion handling | A reduced variant for every animation |
| Untinted `#808080`-style grays | Neutrals tinted slightly toward the brand hue |
| Same radius on a nested element | Inner radius = outer radius − padding |
| Border, shadow, ring, and gradient on one card | One depth cue per surface |
| Per-component `dark:` color overrides | Theme variables that flip once |

## How to work

- **Building:** read the category files for the area, follow the project's conventions, and run through the file's checklist before you finish.
- **Reviewing:** use [review-checklist.md](review-checklist.md). Report findings as `file:line`, the problem, and the fix, ordered by severity. Don't list things that are fine.
- **Something feels off:** name the cause before changing code. For motion, slow the animation down or step through it frame by frame (see [animation-performance-accessibility.md](animation-performance-accessibility.md)). For static UI, check hierarchy, spacing, and alignment first (see [design-foundations.md](design-foundations.md)).
- **Exact values matter.** When a file gives a specific curve, duration, or size, use it instead of approximating.
