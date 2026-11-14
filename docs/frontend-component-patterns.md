# Building factory components from the free affectUI patterns

Use the installed free modules when they fit; use shadcn, Tailwind, and Motion for new factory components. The examples below come from the MIT sources pinned in [the inventory](../resources/affect-ui-free-components.json). They describe reusable patterns, not the unavailable implementation of any Pro component.

## Start here

```tsx
import { CodeBlock } from '@factory/affect-ui/components/code-block-clean';
import { DecisionInbox } from '@factory/affect-ui/components/decision-inbox-clean';
import { SegmentedControl } from '@factory/affect-ui/components/segmented-control-clean';
```

Render these inside `.affect-ui-theme` to inherit the app's colors, font, and radii. The theme bridge is in [globals.css](../apps/web/src/app/globals.css); no Tailwind rewrite or extra dependency is necessary. Use the `-clean` suffix consistently; omit it for Classic. `upstream/` stays unchanged so source hashes and future diffs remain useful.

## Surfaces and typography

| Observed pattern | Source | Factory implementation |
| --- | --- | --- |
| Classic uses a quiet outer tray and a raised inner card; Clean uses a single surface with a hairline | `card.tsx`, `card-clean.tsx`, `decision-inbox-clean.tsx` | shadcn `Card`, `bg-muted/35`, `bg-card`; keep one border/shadow hierarchy |
| Card edge combines a 0.5px hairline with two small shadows | `decision-inbox-clean.tsx`, `tool-call-card-clean.tsx` | `--aui-shadow-card` in the theme bridge; avoid a heavy border plus a large shadow |
| Main text is typically 13px/20px, metadata 12px/16px, icons 14–16px | `button-clean.tsx`, `code-block-clean.tsx` | `text-sm`, `text-xs`, `size-3.5` / `size-4`; use tabular numbers for counts and elapsed time |
| Palette is mostly neutral; blue indicates selection/work, amber decisions, red failures, green confirmation | `decision-inbox-clean.tsx`, `tool-call-card-clean.tsx` | semantic shadcn variables plus explicit text/icon status; never color alone |
| Shared `--aui-*` tokens fall back to component-specific `--ui-*` variables | all three featured modules | bridge shared colors at a wrapper; override an individual component only when needed |

## Interaction and state

- **Controlled data, local presentation.** Segmented Control accepts `value`/`onChange` or `defaultValue`. Tool Call Card accepts status and content as props while handling expansion locally. New factory components should emit callbacks; demos own fictional state, and real integrations own persistence.
- **Immediate feedback, then removal.** Decision Inbox shows the selected answer, updates the pending count, then folds the answered row away. Preserve the confirmed state long enough to read it. Do not remove the only focused control without moving focus to a sensible next target.
- **Stable geometry.** Segmented Control measures labels, keeps the semibold label's width reserved, and moves an indicator rather than changing surrounding layout. Reserve a width for status/count changes; avoid font-weight-driven jumps.
- **Progressive detail.** Tool Call Card keeps a one-line summary and reveals arguments/results on demand. Findings should expose a short title, source, severity, and time before opening a detail panel.
- **Copy exactly, acknowledge success.** Code Block copies the original input string, not its highlighted DOM, then changes the copy icon to a check. Show a useful failure state if clipboard access is unavailable.

## Motion recipe for our own components

The free sources use CSS transitions and Web Animations directly; they do not depend on Motion. Preserve that code. For our shadcn/Tailwind implementations, translate the behavior:

| Behavior | Source observation | Motion equivalent |
| --- | --- | --- |
| Hover/focus color | 140–160ms explicit color/background transitions | Tailwind `transition-colors`, no layout animation |
| Entering rows/feedback | Short opacity/transform transitions, typically 200–360ms | `initial={{ opacity: 0, y: 6 }}`, `animate={{ opacity: 1, y: 0 }}`; usually 200ms |
| Settling surfaces | Repeated easing `cubic-bezier(0.22, 1, 0.36, 1)` | `ease: [0.22, 1, 0.36, 1]` |
| Sliding segmented indicator | Leading edge runs ahead, then trailing edge settles | `layoutId` indicator or measured transform; preserve keyboard/touch behavior |
| Reordered list | Position updates preserve item identity | `m.li layout` with stable data IDs; `AnimatePresence` for departures |
| Reduced motion | CSS media queries and motion preference checks | `useReducedMotion`, duration zero, no entrance offsets or spinning |

Use `LazyMotion` + `domAnimation` + `m` for the factory components. Keep animations attached to user-visible state changes. For graph branches, use a short curve into a vertical lane; never stretch a diagonal over unrelated rows.

## Accessibility and responsive behavior

Follow the interaction model, not only the appearance. Segmented Control has one tab stop, skips disabled options, and supports arrows/Home/End. Its radio mode uses `aria-checked`; its tabs mode uses `aria-selected` and `aria-controls`. Pair tabs with real, named tab panels. Buttons need names and visible focus. Announce new results with a restrained polite live region, and avoid announcing running timers every frame.

The upstream controls are intentionally compact; many touch heights are 32–40px. For new factory interactions, target at least 44px. When placing an upstream control in a critical touch flow, use a wrapper/style override and verify it; do not assume every upstream module already meets that target.

Use `min-w-0`, truncation, and internal scrolling. Drop secondary locations/counts on narrow screens before hiding essential actions. Test an empty list, long labels, loading, completed, failed, and filtered-with-no-results states.

## What helps with the original list

| Planned factory component | Free sources to study/reuse |
| --- | --- |
| Agent Inbox, Approval Card, Agent Steering | Decision Inbox, Segmented Control, Button, Badge, Text Area |
| Agent Monitor, Agent Trail, Trace Waterfall | Tool Call Card, Thinking Loader, Code Block, Scroll Area |
| Agent Plan, Agent Queue, Agent Sequence | Progress Tracker, Tree View, Toggle Group, Empty State |
| Agent Recap, Context Window, Cost Waterfall | Change Summary, Number Ticker, Tooltip, Resizable |
| Chat Composer, Model Picker | Text Area, Select, Popover, Dropdown Menu, Icon Button |
| Conflict Radar, Root Cause Tree | Tree View, Code Block, Decision Inbox, Tooltip |

Consult Pro components' public descriptions and previews for behavior, then implement original data models and UI. The 74 imported items carry their upstream MIT license; our custom components retain their existing location and styling stack.
