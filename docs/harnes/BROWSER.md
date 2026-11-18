# Browser checks

For a component, start `pnpm storybook` and open `http://127.0.0.1:6006`. For a full application flow, use [the local stack](RUNNING.md) and its checkout URL. Read `apps/web/AGENTS.md` before editing web code.

Use the available browser integration for the changed flow. Inspect text and accessible controls first; capture screenshots when judging layout or motion. Check the affected interaction, empty/error state, keyboard behavior and narrow viewport when applicable. Report the URL and what was actually observed; a unit test is not a visual review.

Run one relevant web unit test with `pnpm --filter @factory/web exec vitest run --project unit <test-path>`. For story interactions use `pnpm --filter @factory/web exec vitest run --project storybook-light --project storybook-dark <story-path>`. Build `@factory/affect-ui` first if using these direct Vitest commands in a fresh checkout. Browser installation and fixture conventions: [Storybook](../storybook.md).

Component composition: [patterns](../frontend-component-patterns.md). Server actions and data boundaries: [data contracts](../frontend-data-contracts.md). Load only the relevant design skill sections. Browser tools are unnecessary for CLI, pure domain or documentation changes.
