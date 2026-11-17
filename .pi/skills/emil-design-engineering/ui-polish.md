# UI Polish

The invisible details that make an interface feel finished: nothing shifts, nothing flashes, nothing steals a click, every state exists, and nothing from the build process is left on the page. Run this as a pass over every component you build or review, and before anything ships.

Express every fix in the project's styling system (Tailwind, plain CSS, CSS Modules, CSS-in-JS). Do not add a global stylesheet to a Tailwind codebase or utility classes to a styled-components one. Tokens (z-index scale, font weights) go wherever the project keeps its design tokens.

Type depth (scales, tracking, wrapping, OpenType features, font loading) lives in [typography.md](typography.md). Shadows, borders, gradients, and dark-mode surfaces live in [surfaces.md](surfaces.md). Hover, press, and focus behavior in depth lives in [interaction-details.md](interaction-details.md).

## Text rendering basics

```css
body {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

html {
  -webkit-text-size-adjust: 100%; /* no font inflation in landscape on iOS */
  font-synthesis: none;           /* a weight that never loaded fails visibly instead of being faked */
}
```

- Use real typographic characters in rendered copy: `…` not `...`, curly quotes and apostrophes (`’` `“` `”`), `×` for dimensions, `–` for ranges. Code, identifiers, keys, and log strings stay straight. "Loading..." and "Saving..." in JSX are the usual offenders.
- `text-wrap: balance` on `h1`–`h3`, `text-wrap: pretty` on paragraphs.
- Write sentence case in the markup and apply uppercase with `text-transform`. Hardcoded `GET STARTED` can't be restyled and breaks copy-paste.

## Layout shift

Nothing on the page should move after the user has started reading it.

### Font weight never changes on interaction

Bold-on-hover or bold-on-selected reflows the text and shifts every sibling by a pixel or two. Keep weight constant and signal state with color or background.

```css
/* Wrong */
.tab:hover { font-weight: 600; }
.tab[aria-selected="true"] { font-weight: 600; }

/* Right */
.tab { font-weight: 500; }
.tab[aria-selected="true"] { color: var(--gray-12); }
```

Hunt for `font-weight` inside `:hover`, `.active`, `[aria-selected]`, `[data-state="active"]`, and Tailwind's `hover:font-medium`, `data-[state=active]:font-semibold`.

Define weights as variables so they can be tuned globally:

```css
:root {
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
}
```

### Changing numbers use tabular figures

Proportional digits have different widths, so a ticking counter or an updating price jitters everything beside it.

```css
.counter, .timer, .price, td.numeric { font-variant-numeric: tabular-nums; }
```

Tailwind: `tabular-nums`. Applies to counters, timers, prices, percentages, number columns, and pagination.

### Swapping labels keep their width

A button that goes from "Save" to "Saving…" changes width and shoves its neighbors. Give it a fixed or minimum width, or render both labels in the same grid cell and toggle visibility so the box is sized by the longer one.

### Reserved space for anything that loads

- Skeletons, image placeholders, and dynamic content areas get hardcoded dimensions or `aspect-ratio` matching the loaded state.
- Images and video always declare `width` and `height` (or `aspect-ratio`). The attributes don't set the rendered size; they give the browser the ratio so it reserves the box before the bytes arrive. See [performance.md](performance.md).
- `lazy()` / `dynamic()` imports get a fallback sized like the real component.

### Late UI overlays instead of pushing

A cookie banner, announcement bar, "install the app" prompt, or verify-your-email strip that mounts after a client-side check moves the page under the user. Either overlay it (`position: fixed`, with safe-area padding) or decide on the server whether it shows so its space exists on first paint.

## Interaction states that stay put

- Hover changes color, background, or shadow. It never changes layout, weight, or size of surrounding content.
- Transition only the properties that change, around `150ms ease-out`. Never `transition: all` or Tailwind's `transition-all`.
- Press feedback is `scale(0.97)` on `:active`. Never below `0.95`. Skip it on high-frequency controls. Details in [interaction-details.md](interaction-details.md).
- Gate hover styles behind `@media (hover: hover) and (pointer: fine)` so a tap doesn't leave a control stuck hovered. Tailwind v4's `hover:` already does this; v3 needs `future: { hoverOnlyWhenSupported: true }`.
- Focus outlines stay grey, black, or white. Brand-colored rings clash with the interface. Never remove focus styles; use `:focus-visible`:

```css
:focus-visible {
  outline: 2px solid var(--gray-12);
  outline-offset: 2px;
}
```

- If you style `::selection`, keep it a subtle tint that leaves the text readable.
- `-webkit-tap-highlight-color: transparent` removes the grey tap flash on mobile, which means every control then needs its own `:active` state or touch users get no feedback.

## Hit areas

Interactive elements need at least `44×44px` on touch and `40×40px` on desktop. Extend small controls with a pseudo-element instead of growing their visual size:

```css
/* 16px dismiss icon, 40px effective target */
.toast-dismiss { position: relative; }
.toast-dismiss::before {
  content: "";
  position: absolute;
  inset: -12px; /* 16 + 12 + 12 = 40 */
}
```

```tsx
<button className="relative before:absolute before:-inset-3">
  <XIcon className="size-4" />
</button>
```

Two hit areas must never overlap. If an extended area collides with a neighbor, shrink it to the largest size that doesn't collide. More on touch targets in [touch-accessibility.md](touch-accessibility.md).

## Optical alignment

Mathematical centering often reads as off-center. Adjust until it looks right.

- Button with a trailing or leading icon: icon-side padding = text-side padding minus 2px (`pl-4 pr-3.5` for a trailing icon).
- Play triangles: shift `2px` toward the pointed side (`margin-left: 2px`).
- Asymmetric icons (stars, arrows, carets): fix the SVG `viewBox` or path so the visual mass is centered. A `1px` margin is the fallback.
- Text next to an icon: align to the cap height or x-height center, not the line box. A `1px` vertical nudge is common.

## Stacking: z-index scale and isolation

`z-index: 9999` is how a toast ends up behind a modal, a dropdown gets clipped under a sticky header, and a tooltip disappears inside a dialog. These collisions only show up when two layers meet. Use a fixed scale and nothing else:

```css
:root {
  --z-dropdown: 100;
  --z-modal: 200;
  --z-tooltip: 300;
  --z-toast: 400;
}
```

- If the project has a scale, move strays onto it. If it doesn't, fix the provable collisions and propose a scale rather than inventing one mid-change.
- When a component only needs its children contained, use `isolation: isolate`. It creates a local stacking context so internal z-indexes can't leak above unrelated UI. `position: relative` alone does not create one; it needs a non-`auto` `z-index`.
- Portal overlays (dialogs, popovers, toasts) to the body so ancestors with `overflow: hidden` or `transform` can't clip or trap them. Don't mix portaled and non-portaled overlays.
- Test the stack: open a modal, trigger a toast, open a dropdown inside the modal, hover a tooltip inside the dropdown.

## Scrollbars

Never replace the page scrollbar. Customize scrollbars only inside small scrollers like code blocks. Standard properties first, `::-webkit-scrollbar` as the fallback for browsers without `scrollbar-color`. A black thumb vanishes in dark mode, so flip it.

```css
:root { --scrollbar-thumb: rgba(0, 0, 0, 0.2); }
.dark { --scrollbar-thumb: rgba(255, 255, 255, 0.2); }

@supports (scrollbar-color: auto) {
  .code-block {
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
  }
}

@supports not (scrollbar-color: auto) {
  .code-block::-webkit-scrollbar { width: 8px; height: 8px; }
  .code-block::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb);
    border-radius: 4px;
  }
}
```

Don't apply edge fades to scrollable lists; the fade hides content the user is trying to read.

## Truncation and long content

Dev data has "Test Project". Real data has a 90-character name, an email with no break opportunity, and German compound words.

```css
/* Multi-line clamp in cards and grid cells */
.cell-text {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Long unbroken strings */
.card-text { overflow-wrap: break-word; }
```

- A flex child needs `min-width: 0` before `text-overflow: ellipsis` does anything.
- Truncation needs an escape hatch: a `title` attribute, a tooltip, or an expand control. An ellipsis with no way to read the rest hides data.
- Check cards, table cells, sidebar items, breadcrumbs, and avatar-with-name rows. Wrapping and clamping in depth: [typography.md](typography.md).

## Safe areas and anchors

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

`viewport-fit=cover` is what makes `env(safe-area-inset-*)` non-zero. Then pad anything pinned to an edge:

```css
.footer { padding-bottom: env(safe-area-inset-bottom); }
.sidebar { padding-left: env(safe-area-inset-left); }
.bottom-bar { padding-bottom: max(12px, env(safe-area-inset-bottom)); }
```

Never add `maximum-scale` or `user-scalable=no` to the viewport. Mobile viewport detail lives in [mobile.md](mobile.md).

In-page anchors clear the sticky header:

```css
[id] { scroll-margin-top: 64px; } /* the sticky header's real height */
```

## The four states of every data view

Every data-driven view has four states: loading, empty, error, and full. The developer usually only saw the last one; a new user sees the other three first. For each view, find all four branches in the code. A branch that doesn't exist is the bug.

### Empty states teach

An empty list is a first-run screen. Show a short headline, one line of explanation, and the primary action that creates the first item.

```jsx
if (projects.length === 0) {
  return (
    <EmptyState
      title="No projects yet"
      description="Projects hold your team's work. Create one to get started."
      action={<Button onClick={createProject}>Create project</Button>}
    />
  );
}
```

- Hunt for `.map()` with no `length === 0` branch, `return null` on empty data, and bare "No items" / "No data".
- Size the empty state to the dimensions of the filled state so completing the action doesn't shift the layout.
- A search or filter with no results is a different empty state: say what was searched and offer to clear it.

### Loading holds the page's shape

- Skeletons for content, matching the loaded content's height and row count (`.row-skeleton { height: 48px; }` is the loaded row's height, not a guess). A centered spinner as the loading state of a list or page collapses the layout and then everything jumps.
- Spinners for an action inside a control, like a submitting button.
- Every wait over 400ms gets an indicator. Silence past that reads as broken and the user clicks again.
- Delay the indicator about 150ms so fast responses never flash a spinner.

### Errors offer a way forward

An error state says what happened and offers a specific recovery: a retry that refetches, or a link back to something that works. "Something went wrong" with no next step ends the journey.

- Hunt for data hooks whose `error` / `isError` is never read, `fetch` with no `.ok` check, and routes with no error boundary (`error.tsx`, `errorElement`).
- Ship a styled 404 and error page. The framework defaults are off-brand and say nothing.
- Wrap complex widgets in an error boundary so one broken widget doesn't take down the page.
- Optimistic updates restore the previous value on failure and say so ("Couldn't update. Try again."). See [performance.md](performance.md).

### Copy actions confirm

A copy button with no feedback gets clicked three more times. Swap the icon to a checkmark for about 1.5s.

## No flash on refresh

Interactive components render their real state on the first paint. Default-then-correct (`useState(false)` followed by an effect that reads `localStorage`) produces the theme that flashes light, the sidebar that snaps shut, the tab that jumps. The server can't read `localStorage`, so choose by where the state lives:

- **Root theme**: a blocking inline script in `<head>` sets the class or `data-theme` on `<html>` before paint. `next-themes` does this; a hand-rolled toggle usually doesn't.
- **Server-rendered layout state** (sidebar collapsed, active tab, density): persist it in a cookie and read it on the server so the HTML arrives correct.
- **Client-only state**: `useState(() => readStoredValue())` with a lazy initializer, or mount the surface after hydration inside a placeholder sized like the real thing.

Theme switches must not tween every color at its own speed. Suppress transitions during the swap; the snippet is in [surfaces.md](surfaces.md#theme-switching).

## Inert decoration

- Gradient overlays, glows, noise, and fades positioned over controls get `pointer-events: none`. Otherwise they swallow clicks at whatever width they happen to overlap a button.
- Code-built illustrations get `user-select: none` so dragging across them doesn't highlight random shapes.
- Buttons get `user-select: none` too. Content stays selectable; never set `user-select: none` on `body`.

```css
.hero-glow, .fade-overlay { pointer-events: none; }
.illustration, button, [role="button"] { user-select: none; -webkit-user-select: none; }
```

## Content hygiene

Nothing in this section shows up as a bug. The app works; it just says "Lorem ipsum" on the pricing page.

### Placeholder content

Search source and content directories (case-insensitive) before shipping:

```
lorem|ipsum|dolor sit          placeholder text|your text here
John Doe|Jane Doe|Acme         example\.com|test@|foo@bar
TODO|TBD|coming soon|WIP       Untitled|New Page|My App
\$0\.00|\$99|XX|###            via\.placeholder|placehold\.co|picsum
```

Seeded demo data inside a docs example is fine. Vet each hit.

### Fabricated proof

Generated landing pages invent social proof: "Trusted by 10,000+ teams", a testimonial from "Sarah K., Product Lead", a logo wall of non-customers, "99.9% uptime", "SOC 2 compliant". Every number, quote, and logo needs a real source. Never reword one to make it vaguer; remove it or flag it for the user to confirm. Never write a testimonial or statistic yourself.

### Specific labels and errors

| Instead of | Write |
| --- | --- |
| "Submit", "OK" | "Save changes", "Send invite", "Create project" |
| "Invalid input" | "Your email must include an @" |
| "No items" | "No projects yet. Create one to get started." |
| "Click here", "Learn more" as the whole link | Link text that names the destination |

Use sentence case for UI labels. When the right label is obvious from the handler (`onClick={saveChanges}`), apply it; when it isn't, flag it.

### Dead links, favicon, metadata

- No `href="#"` or `href=""` on links that were never wired up. Footer columns and social icons are where they hide.
- Replace the framework's default favicon and title ("Create Next App", "Vite + React").
- Every page has a real `<title>` and description, and `<html lang>` set to the content's language. Missing `lang` breaks hyphenation, screen reader pronunciation, and translation prompts.
- Image `alt` text is never the filename.
- Format dates, numbers, and currency with `Intl.DateTimeFormat` / `Intl.NumberFormat`, not string concatenation.

```tsx
export const metadata: Metadata = {
  metadataBase: new URL("https://example.com"),           // the production origin
  title: { default: "Product", template: "%s · Product" },
  description: "…",
};
```

## Leftovers hygiene

- **Debug output**: remove `console.log`, `console.debug`, `console.table`, `debugger`, `alert(`, and `JSON.stringify` dumped into a `<pre>`. Keep `console.error` in error boundaries and real `catch` handlers. `console.log(user)` or `console.log(session)` is a data leak.
- **Dev tools**: control panels (`leva`, `tweakpane`, `dat.gui`), `ReactQueryDevtools`, `react-scan`, debug and grid overlays are gated to development and imported dynamically so the package stays out of the production bundle. A static import with a gated render still ships the bytes. Values dialed in with a panel live in a config file production imports, never in a panel default.

```jsx
{process.env.NODE_ENV === "development" && <DevPanel />}
```

- **Scaffolding routes**: `/playground`, `/sandbox`, `/test`, `/debug`, `/styleguide`, prototype routes. Gate them out of production (`if (process.env.NODE_ENV === "production") notFound();`) and let the user decide whether to delete them.
- **Secrets and dev URLs**: no `localhost`, `127.0.0.1`, `ngrok`, or staging hosts in source; no `NEXT_PUBLIC_*` / `VITE_*` variables holding secret keys. Anything in a client bundle is public.
- **Commented-out code** gets deleted; git has it. A `TODO` gets read, not deleted: one on an auth, payment, or deletion path is a real finding.
- **Code tells**: comments that narrate the next line (`// Set loading to true`) or talk to a reviewer (`// Updated per feedback`), `try/catch` that logs and continues, `catch { return [] }` fallbacks that hide a broken request, `as any` casts, `V2` / `New` / `Enhanced` names, unused imports. Delete them in code you're touching. A surviving comment states something the code can't: a constraint, a unit, the bug it works around.
- **Emoji as functional icons** in product UI render differently on every platform. Use an icon set.

## Checklist

- [ ] No font-weight change on hover or selection; dynamic numbers use `tabular-nums`
- [ ] Skeletons, images, video, and lazy components reserve their final size; late banners overlay
- [ ] Transitions name their properties; focus rings neutral and intact; hover gated to fine pointers
- [ ] Hit areas at least 44×44 touch / 40×40 desktop, never overlapping
- [ ] Icons optically centered
- [ ] Z-index from a fixed scale, or `isolation: isolate`; overlays portaled
- [ ] Page scrollbar native; small scrollers styled for both themes
- [ ] Long strings truncate or wrap with a way to read the full value
- [ ] Safe-area padding on edge-pinned UI; `scroll-margin-top` on anchors
- [ ] Every data view has designed loading, empty, error, and full states
- [ ] No flash on refresh; theme switch suppresses transitions
- [ ] No placeholder copy, fabricated proof, dead `#` links, default favicon/title, debug logs, or ungated dev tools
