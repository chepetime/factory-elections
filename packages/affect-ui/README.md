# affectUI free library

All 74 MIT items from [flohoeller/affectui](https://github.com/flohoeller/affectui), pinned to commit `46721aa59276d97927a8cb89ee898027b637834d` (checked 2026-11-13). This includes 51 components, 2 blocks, 17 illustrations, and 4 motion effects. Classic and Clean variants are included where upstream supplies both.

`upstream/` is a byte-for-byte copy of those source directories. The upstream [MIT license](LICENSE) applies to every file there. Copyright © 2026 Florian Höller (adfects). No Pro source is included. The independently implemented Agent Checkpoints and Agent Findings live in the web app.

## Use in the web app

```tsx
import { CodeBlock } from '@factory/affect-ui/components/code-block-clean';
import { DecisionInbox } from '@factory/affect-ui/components/decision-inbox-clean';
import { SegmentedControl } from '@factory/affect-ui/components/segmented-control-clean';
```

Omit `-clean` for Classic. Illustrations and motion effects have a single version. All modules are imported individually; there is no barrel that adds the entire library to a page.

Run `pnpm --filter @factory/affect-ui build` to emit JavaScript and declarations into ignored `dist/`. The web app's dev, build, typecheck, and test commands build this dependency automatically. The package requires React 19 and no animation or styling dependencies.

Upstream is compiled under its own strict TypeScript configuration, with standard indexed-access behavior. The web app retains its stricter `noUncheckedIndexedAccess` setting and consumes the package's declarations. This avoids hundreds of mechanical edits to third-party code while retaining type checking at the integration boundary. Upstream source is excluded from repo formatting and lint rewrites; our wrappers, gallery, and integration code remain checked normally.

All 74 items now have individual previews and Autodocs in Storybook (`pnpm storybook`), including every installed Classic/Clean variant. The catalog links each item to its story.

See [the verified inventory](../../resources/affect-ui-free-components.json) for every import path, export name, source URL, and SHA-256; see [component patterns](../../docs/frontend-component-patterns.md) for reusable conventions.

## Updating

1. Inspect the official upstream MIT repository and pin the new commit. Check license changes and source diffs before replacing files.
2. Replace only this package's `upstream/` directories and retain the upstream license.
3. Update the inventory, including hashes and the pinned source URLs. Do not classify an item as free solely because a website preview is visible.
4. Run the package build, web typecheck/tests/build, and browser-check affected previews in both styles.
