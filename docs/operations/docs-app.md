# Docs app

`apps/docs` is a [Fumadocs](https://fumadocs.dev) site. It renders the repository `docs/` folder. There is no second copy of the content.

## Run

```sh
pnpm docs
```

Open http://localhost:3100. Search, a Markdown copy button, and `/llms.txt` work. Edits to `docs/**/*.md` reload in the browser.

## Add or change a page

- Write plain Markdown in `docs/`. Start the file with one `# ` heading. That heading is the page title.
- Frontmatter is optional. Use `title` or `description` only to override the defaults.
- Link to other pages with relative file paths, for example `[Worktrees](../worktrees.md)`. The site turns them into page links.
- A folder needs a `meta.json` only to set its sidebar title or page order.

Keep pages short and direct. Agents read the same files, so every line costs tokens.

## How it works

- `apps/docs/src/lib/source.ts` loads `../../docs` with `fumadocs-mdx`. It takes the title from the first `# ` heading.
- The page view does not add a separate title, because the body has one.
- `apps/docs/next.config.mjs` aliases `fumadocs-core/server`. The compiled pages live outside the app, so they cannot find the app's `node_modules` without it.

Check: `pnpm --filter @factory/docs typecheck`.
