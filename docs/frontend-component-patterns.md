# UI components

Every shared UI element lives in `packages/ui` (`@factory/ui`): the shadcn components, the effect components (call chip, hold button, lattice loader, specular button, thought line), `CodeBlock`, `cn`, and the theme stylesheet. `apps/web` composes them into factory components in `apps/web/src/components`.

```tsx
import { Button } from '@factory/ui/components/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from '@factory/ui/components/dropdown-menu';
import { cn } from '@factory/ui/lib/utils';
```

The package ships TypeScript source; Next transpiles it (`transpilePackages`), so there is no build step. It may not import other workspace packages, Node APIs or Next.js (lint enforces the first two): a component that renders a link takes Base UI's `render` prop, e.g. `render={<Link href="/projects" />}`.

## Add a shadcn component

```sh
cd packages/ui
yes n | pnpm exec shadcn add <name>   # "n": never overwrite a component we already adjusted
pnpm exec prettier --write src
```

`packages/ui/components.json` uses the Base UI style (`base-nova`). Keep imports inside the package relative (`../lib/utils`, `./button`). Then check the generated defaults against the app's look below and adjust the component itself: shadcn code is ours to change, and a call site should not repeat the same overrides.

Two generated components dropped `orientation` before it reached Base UI, which left vertical tabs answering only the left and right arrows. Check that a new component passes through every prop that changes behavior.

## The app's look

The adjusted defaults, so new components match:

| Element | Classes |
| --- | --- |
| Dialog | backdrop `bg-black/40` with a fade; popup `rounded-2xl border bg-background p-5 shadow-2xl`, scales from 0.98; text size inherited, not `text-sm` |
| Menu and popover | `rounded-xl border bg-popover p-1 shadow-lg`, fade only, `sideOffset` 6; items `rounded-md px-2.5 py-1.5 gap-2` |
| Highlighted menu item | `bg-accent`; children keep their own colors (status tones, muted icons, red warnings) |
| Section list (settings) | `TabsList`/`TabsTrigger` `variant="nav"`; the call site sets the direction and sizes |
| Code and diffs | `CodeBlock`: `--code-*` and `--diff-*` theme tokens, `language="diff"` colors added and deleted lines, `tone="destructive"` for failed output |

Theme tokens are in `packages/ui/src/styles/globals.css`, light and dark. Apps import that file and add an `@source` for `packages/ui/src` by its real path (see `apps/web/src/app/globals.css`); without it Storybook's build drops classes used only in the package. Effect components may use CSS modules beside them.

## Interaction and state

- **Controlled data, local presentation.** Take `value`/`onChange` (or `defaultValue`) and emit callbacks; demos own fictional state, real integrations own persistence.
- **Immediate feedback, then removal.** Show a confirmed state long enough to read it, and move focus to a sensible target before removing the focused control.
- **Stable geometry.** Reserve width for counts and status changes; avoid layout jumps from font weight.
- **Progressive detail.** A one-line summary first; arguments, output and findings on demand.
- **Copy exactly, acknowledge success.** Copy the original string, not highlighted DOM, then show a check; handle a blocked clipboard.

## Motion

| Behavior | Recipe |
| --- | --- |
| Hover/focus color | `transition-colors`, no layout animation |
| Entering rows/feedback | `initial={{ opacity: 0, y: 6 }}`, `animate={{ opacity: 1, y: 0 }}`, about 200ms |
| Settling surfaces | `ease: [0.22, 1, 0.36, 1]` |
| Reordered list | `m.li layout` with stable IDs; `AnimatePresence` for departures |
| Reduced motion | `useReducedMotion`, duration zero, no entrance offsets or spinning |

Use `LazyMotion` + `domAnimation` + `m`, and animate only user-visible state changes.

## Accessibility and responsive behavior

Prefer the shadcn component over a hand-built role: it brings Base UI's focus management and keyboard handling. Buttons need names and visible focus; pair tabs with named panels; announce results with a polite live region, never a running timer. Target at least 44px touch heights (`pointer-coarse:min-h-11`). Use `min-w-0`, truncation and internal scrolling, and test empty, long, loading, completed, failed and filtered-to-nothing states in light and dark.
