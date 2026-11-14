# Component workshop

Run `pnpm storybook` from the repository root and open <http://127.0.0.1:6006>. Storybook is the isolated development and documentation environment; `/components` remains the in-app gallery.

The setup uses Storybook 10.6 with React/Vite because these components take plain React props. It imports the same Tailwind/shadcn stylesheet and affectUI theme bridge as the app. Next.js server data, actions, and the factory CLI stay outside the stories; use explicit fixtures and callbacks at that boundary.

## What is included

- **Library:** searchable inventory of all 74 installed MIT items and the patterns guide.
- **Factory:** Agent Checkpoints (branched, empty, read-only, long history, interactive) and Agent Findings (running, empty, no findings, completed, interactive).
- **affectUI:** individual Autodocs and live stories for all 74 free items, grouped into Components (51), Blocks (2), Illustrations (17), and Motion (4). All 127 installed style variants have a preview. Classic and Clean use matching fixtures; compound components render primitives from the same variant. The original detailed stories for Code Block, Decision Inbox, and Segmented Control are retained.
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
```

Every command builds the local `@factory/affect-ui` dependency before using it. Static output is ignored by Git. Storybook runs on loopback and has telemetry disabled. pnpm explicitly permits the esbuild package's install script, required by Storybook's tooling.

`pnpm check` runs formatting, lint, types, and the existing CLI/unit tests. `pnpm storybook:test` separately runs all 143 stories (286 browser checks) in Chromium in both light and dark themes, including click/keyboard flows and axe checks. The tests request reduced motion to inspect settled states rather than capturing intermediate fades. Accessibility tests fail on violations, with the two narrowly scoped exceptions documented below. Passing stories covers these fixtures, not every possible state of all 74 imported modules.

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

Add representative running/completed/failed states and long or empty data when relevant. Use a local demo wrapper for stateful interactions. Import an upstream MIT component through `@factory/affect-ui/components/<slug>-clean`; the original source and license stay in `packages/affect-ui/`.

For a meaningful user flow, add a `play` function using `within`, `userEvent`, and `expect` from `storybook/test`. Test the observable result: a branch is preserved, a filter narrows the feed, an answer triggers the expected callback, or keyboard selection skips a disabled option. Avoid tests that merely repeat the JSX.

## Integration adjustments

The first accessibility pass found insufficient contrast in the initial muted/destructive palette and some upstream token defaults. The shared stylesheet now darkens those tokens and adjusts code colors, line numbers, and decision accents in `.affect-ui-theme`. Upstream source remains unchanged and hash-verifiable. The custom row buttons use their visible text as their accessible name, with additional status information in visually hidden text.

Use [the patterns guide](frontend-component-patterns.md) for further shadcn/Tailwind/Motion implementations. Recheck theme overrides against both light and dark stories when updating upstream source.

## Coverage and accessibility exceptions

`resources/affect-ui-free-components.json` records the Storybook title and base ID for every item. A unit test verifies that every inventory entry imports each installed style variant and exports its corresponding story. The built Storybook index is also checked against the inventory when verifying this migration. Each story links to the relevant usage reference and the exact upstream source revision.

The shared theme bridge adjusts additional low-contrast labels in badges, card footers, summary headings, comments, email statuses, illustrations, marquee labels, testimonial initials, and shimmer text. The upstream files remain byte-for-byte unchanged.

Two checks are scoped explicitly rather than altering correct semantics or flattening an illustration's intentional fading:

- **Tree View:** axe 4.14's `label-content-name-mismatch` rule counts expanded child items and `aria-describedby` metadata as part of the parent's label. This tree uses `aria-labelledby` for each individual node, as expected for independently named [ARIA tree items](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/). Only this rule is disabled in the Tree View stories. Their play tests separately verify exact accessible names, metadata descriptions, keyboard focus, and expansion/collapse in both styles. Other axe rules remain active. This is not a substitute for assistive-technology testing.
- **Model Wheel:** only the `.ui-mw-drum` artwork is excluded from axe's context. Upstream already marks it `aria-hidden="true"`; its labels intentionally fade with perspective, and the root image provides an accessible description. The surrounding component remains in the scan.

The input, menu, dialog, pagination, and tree stories exercise their real controls, including keyboard handling and focus restoration. Sample actions only update local preview state or log callbacks. No network requests, emails, project mutations, or external images are needed by these fixtures.
