# Component workshop

Run `pnpm storybook` from the repository root and open <http://127.0.0.1:6006>. Storybook is the isolated development and documentation environment; `/components` remains the in-app gallery.

The setup uses Storybook 10.6 with React/Vite because these components take plain React props. It imports the same stylesheet as the app, which imports the `@factory/ui` theme. Next.js server data, actions, and the factory CLI stay outside the stories; use explicit fixtures and callbacks at that boundary.

## What is included

- **Factory:** Agent Checkpoints (branched, empty, read-only, long history, interactive), Agent Findings (running, empty, no findings, completed, interactive), and Chat Composer (21 stories covering menus, attachments, sending, approval modes, dictation, and narrow layouts).
- **shadcn:** `@factory/ui` components with their own stories, such as Code Block (TypeScript, JSON, diff, failed output, long lines).
- **Controls and Autodocs:** inspect props and try different inputs. `fn()` callbacks appear in the Actions panel. Interactive stories own sample state.
- **Theme and viewport tools:** switch Light/Dark in the toolbar and select Phone, Tablet, or Desktop. Reduced motion follows the OS in the workshop.
- **Accessibility and interaction tests:** use the test addon or run the browser suite from the CLI.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm storybook
pnpm storybook:build

# Once on a fresh machine, install the browser used by the test project:
pnpm --filter @factory/web exec playwright install chromium
pnpm storybook:test

# Exercise the composer with ordinary animations enabled as well:
STORYBOOK_MOTION=normal pnpm --filter @factory/web exec vitest run \
  --project storybook-light --project storybook-dark src/stories/chat-composer.stories.tsx
```

Nothing needs building first: `@factory/ui` is TypeScript source. Static output is ignored by Git. Storybook runs on loopback and has telemetry disabled. pnpm explicitly permits the esbuild package's install script, required by Storybook's tooling.

`pnpm check` runs formatting, lint, types, and the existing CLI/unit tests. `pnpm storybook:test` separately runs all 54 stories (108 browser checks) in Chromium in both light and dark themes, including click/keyboard flows and axe checks. The tests request reduced motion to inspect settled states rather than capturing intermediate fades. Accessibility tests fail on violations. Passing stories covers these fixtures, not every possible state.

## Add a component

Create `apps/web/src/stories/<name>.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { MyComponent } from '@/components/my-component';

const meta = {
  title: 'Factory/My Component',
  component: MyComponent,
  tags: ['autodocs'],
  args: { items: [], onSelect: fn() },
} satisfies Meta<typeof MyComponent>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
```

Add representative running/completed/failed states and long or empty data when relevant. Use a local demo wrapper for stateful interactions. Import shared components from `@factory/ui/components/<name>`; a component that belongs in `packages/ui` gets its story under the `shadcn/` title.

For a meaningful user flow, add a `play` function using `within`, `userEvent`, and `expect` from `storybook/test`. Test the observable result: a branch is preserved, a filter narrows the feed, an answer triggers the expected callback, or keyboard selection skips a disabled option. Avoid tests that merely repeat the JSX.

## Styling and accessibility

The stories render with the app's theme, so contrast checks cover the real tokens in light and dark. When a check fails, fix the token or component in `packages/ui` rather than the story. Use [the UI components guide](frontend-component-patterns.md) for conventions.

## Original implementations and roadmap

The original 26 requested items remain in `resources/frontend-component-origins.json`. `resources/frontend-component-support.json` tracks the same names, order, and public references with implementation status, source path, and Storybook link. The gallery exposes this list under **Support roadmap**. Implemented means a reusable component with a local demo; application integration is tracked separately.

See [Chat Composer](chat-composer.md) for its integration contract and public reference.
