# Performance

Loading, rendering, and perceived speed for interfaces: virtualization, preloading, images, fonts, bundles, re-renders, debouncing, optimistic UI, and how to measure. Read this when building anything that renders long lists, loads media, imports heavy dependencies, or feels slow.

Fast UI is mostly work you don't do: don't render nodes nobody can see, don't ship bytes nobody uses, don't fetch per request what you could build once, and don't move layout after the user starts reading. Most fixes delete or defer work. Frame budget for motion (composite-only properties, `will-change`, blur cost, `transition: all`, keeping animation out of React renders) lives in [animation-performance-accessibility.md](animation-performance-accessibility.md).

## Rendering less

### Virtualize long lists

Virtualize any list that is unbounded or can exceed 200 rows: tables, feeds, logs, comboboxes, pickers. The dev database had forty rows; the first real customer imports ten thousand.

```jsx
import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

function VirtualList({ items }) {
  const parentRef = useRef(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 50,
  });

  return (
    <div ref={parentRef} style={{ height: 400, overflow: "auto" }}>
      {/* The spacer is the rows' containing block: without position: relative
          they position against the nearest positioned ancestor instead */}
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: virtualItem.size,
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            {items[virtualItem.index]}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- Use the project's existing virtualizer (`@tanstack/react-virtual`, Virtuoso). Don't swap one for another unasked.
- Rows of varying height: pass `measureElement` so the virtualizer measures real sizes instead of trusting `estimateSize`.
- Pagination or "load more" is a valid alternative when users don't need to scroll the full set.
- For long static pages, `content-visibility: auto` with `contain-intrinsic-size` skips rendering off-screen sections without a library:

```css
.feed-section {
  content-visibility: auto;
  contain-intrinsic-size: auto 600px; /* estimated height, so the scrollbar doesn't jump */
}
```

### Avoid unnecessary re-renders

- Keep state as close as possible to where it's used. State in a root provider re-renders every consumer on every change.
- Split contexts by update frequency. A context holding `{ user, theme, cursorPosition }` re-renders everything that reads `user` whenever the cursor moves.
- Don't create objects, arrays, or functions inline in a context value or in props to a memoized child. Memoize the value or lift the constant out.
- Derive values during render instead of syncing them into state with `useEffect`. An effect that calls `setState` causes a second render every time.
- If the project uses the React Compiler, skip manual `useMemo` / `useCallback`. Otherwise memoize only what a profile shows is expensive or what feeds a memoized child.
- High-frequency values (scroll position, pointer position, drag offset) never go through `setState`. Write to the element via a ref or a Motion value. Details in [animation-performance-accessibility.md](animation-performance-accessibility.md).
- Use `useDeferredValue` or `startTransition` for expensive renders triggered by typing, so the input stays responsive while the results list catches up.

### Stop work that's off-screen

Looping animations, video, canvases, and polling that keep running while scrolled out of view or in a background tab burn battery and CPU for nothing.

```js
const observer = new IntersectionObserver(([entry]) => {
  entry.isIntersecting ? start() : pause();
});
observer.observe(element);

document.addEventListener("visibilitychange", () => {
  document.hidden ? pausePolling() : resumePolling();
});
```

## Loading less

### Code splitting

A chart library, rich-text editor, syntax highlighter, or confetti effect imported in the root layout is downloaded and parsed by every visitor, including those who never open the screen that uses it.

```jsx
const Editor = dynamic(() => import("./editor"), {
  loading: () => <EditorSkeleton />, // reserves the editor's box
});

// Plain React
const Chart = lazy(() => import("./chart"));
<Suspense fallback={<ChartSkeleton />}><Chart /></Suspense>
```

- Split modals, editors, and dashboards that open on demand. Start the import on hover or focus of the trigger so it's ready by click.
- The fallback is sized like the real component so nothing shifts when it arrives.
- Code splitting by route comes free with file-based routers. Don't fight it by importing page-level code into a shared layout.

### Bundle size

- Import specific modules, not namespaces: `import debounce from "lodash/debounce"`, not `import _ from "lodash"`. Same for icon packs: named imports from a tree-shakable package, never the whole set.
- Check the cost before adding a dependency (bundlephobia, `pkg-size`). A date library for one format call is an `Intl.DateTimeFormat` you didn't write.
- Prefer platform features to libraries: `Intl` for formatting, `<dialog>` and the Popover API for simple overlays, CSS for animations that don't need physics or interruption.
- Dev-only tools (inspectors, control panels, `why-did-you-render`) are imported dynamically behind a `NODE_ENV === "development"` check. A static import with a gated render still ships the bytes.
- If the project has a bundle analyzer, run it and look at the three largest client chunks. Don't add one mid-feature.
- In React Server Component setups, keep heavy rendering (markdown parsing, syntax highlighting) on the server so it never ships to the client. Push `"use client"` boundaries down to the smallest interactive leaf.

### Static generation

Blog posts, docs, changelogs, and pricing don't change per request. Build them once and revalidate:

```tsx
// Next.js App Router: a Server Component rendered at build time
export const revalidate = 3600; // revalidate hourly

export async function generateStaticParams() {
  return (await fetchPosts()).map((post) => ({ slug: post.slug }));
}

export default async function BlogPage() {
  const posts = await fetchPosts();
  return <PostList posts={posts} />;
}
```

Reading `cookies()` or `headers()` in a marketing layout opts the whole subtree out of static rendering; so do `dynamic = "force-dynamic"` and `cache: "no-store"` on CMS calls. An auth-aware "Log in / Dashboard" button is the usual culprit. Keep the page static and resolve that one button on the client.

## Images

### Reserve the space

An image or video without dimensions has zero height until it loads, then shoves the page down under the user's finger.

```html
<img src="/hero.webp" width="1200" height="630" alt="…" />
```

```css
.video-frame { aspect-ratio: 16 / 9; }
```

`next/image` with `fill` needs a parent with a defined size.

### Serve the size that's shown

A 4000px PNG decoded to show a 64px avatar costs bandwidth, decode time, and memory on the devices with the least of each.

- Use the framework's image component with `sizes`, or `srcset` by hand. Avatars and thumbnails point at resized variants, never the original upload.
- WebP or AVIF for photos, SVG for anything drawn. Photos in `public/` over ~300KB are a finding.
- Serve at least 2x the displayed size for retina. An image scaled up ships blurry.
- Don't set `unoptimized` on `next/image` without a reason.

### Prioritize the hero, lazy-load the rest

```html
<link rel="preload" as="image" href="/hero.webp" fetchpriority="high" />
<img src="/gallery-12.webp" loading="lazy" decoding="async" width="600" height="400" alt="…" />
```

- The LCP image (hero, first product shot) is preloaded or gets `priority` in Next.js. Never `loading="lazy"` on it; that delays the one image that matters.
- Below-the-fold images get `loading="lazy"`.
- Never `priority` on every image. Prioritizing everything prioritizes nothing.
- Videos below the fold use `preload="none"` or `preload="metadata"` and a `poster` image.

## Fonts

An un-preloaded font is discovered late and swaps in after first paint, shifting every line.

```html
<link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin />
```

```jsx
import { preload } from "react-dom";
preload("/fonts/inter-var.woff2", { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
```

- `crossorigin` is required even for same-origin fonts. Without it the preload is fetched and then thrown away.
- Serve `woff2` only. Subset to the alphabets you render.
- Prefer one variable font over several static weights, and load only the weights the CSS uses. Eight weights loaded for three used is dead weight on every visit.
- Preloading shortens the fallback window but doesn't remove the swap. To stop the swap from reflowing text, match the fallback's metrics with `size-adjust`, `ascent-override`, and `descent-override`. `next/font` does both preload and metric matching; if the project uses it, check that only the used weights and subsets are listed.
- Preload only the one or two fonts used above the fold. Every preload competes with the hero image.

Font formats, axes, and fallback stacks in depth: [typography.md](typography.md).

## Network and input

### Preload routes and data

- Framework `<Link>` components prefetch routes in the viewport. Don't disable that on primary navigation.
- For custom triggers, prefetch on `pointerenter` or `focus`: the 100–300ms between hover and click is usually enough to hide the fetch.
- Use `<link rel="preconnect">` for third-party origins needed on first paint (font CDN, image CDN, API). Limit it to two or three; each one opens a connection.
- Start data fetches as early as possible: in the route loader or server component, not in a `useEffect` after the component mounts. Effect-driven fetches waterfall: parent renders, fetches, child renders, fetches.

### Debounce and cancel

A request per keystroke hammers the server and creates races where an older response overwrites a newer one. Debounce search at about 300ms and abort stale requests:

```js
useEffect(() => {
  const controller = new AbortController();
  const id = setTimeout(() => search(query, controller.signal), 300);
  return () => {
    clearTimeout(id);
    controller.abort();
  };
}, [query]);
```

- Throttle `resize` and `scroll` handlers that read layout (`getBoundingClientRect`, `offsetHeight`), or replace them with `ResizeObserver` / `IntersectionObserver`.
- Mark scroll and touch listeners `{ passive: true }` so they never block scrolling.
- Batch layout reads before writes. Interleaving `offsetHeight` reads with style writes in a loop forces a synchronous layout on every iteration.

### Optimistic UI

For actions that almost always succeed (toggle, like, rename, reorder, mark as read), update the UI immediately and reconcile with the server after. Waiting for a round trip makes a 50ms action feel like 500ms.

```jsx
const [optimisticTodos, addOptimistic] = useOptimistic(todos, (state, newTodo) => [
  ...state,
  { ...newTodo, pending: true },
]);
```

- Always roll back on failure and say so: "Couldn't update. Try again." An optimistic update that never reverts shows a saved state the server never heard about. With React Query, every `onMutate` has an `onError` that restores the snapshot.
- Mark pending items subtly (reduced opacity) when the distinction matters.
- Don't go optimistic for payments, deletions that can't be undone, or anything where a false success causes harm.
- Disable or deduplicate the trigger while a non-optimistic request is in flight so double-clicks don't double-submit.

## Perceived performance

What the user feels is what counts.

- **Respond within 100ms.** Every click, press, and keystroke gets visible feedback immediately (pressed state, optimistic update, pending indicator), even if the work takes longer.
- **Indicator after 400ms of silence.** Past that, the user assumes it's broken and clicks again.
- **Delay the indicator about 150ms.** Fast responses never flash a spinner. If a spinner does appear, keep it visible for at least 300–500ms so it doesn't flicker.
- **Skeletons for content, spinners for actions.** A skeleton that matches the loaded layout makes the wait feel shorter and causes no shift on arrival. See [ui-polish.md](ui-polish.md).
- **Stream.** Send the shell first and stream slow sections with `<Suspense>` boundaries so the fast parts aren't held back by the slowest query.
- **Keep the previous content visible** during refetches and tab switches (`placeholderData: keepPreviousData`, `startTransition`) instead of blanking to a skeleton every time.
- **Don't add artificial delays** to make something feel "considered". Faster is always better for repeated actions.

## Measuring

- Profile on a mid-range phone over remote debugging, not with CPU throttling on a laptop. Throttling models a slow CPU, not a weak GPU or a small memory budget.
- Run Lighthouse against the production build, never the dev server. Dev mode React is several times slower and unminified.
- Track the Core Web Vitals: LCP under 2.5s, INP under 200ms, CLS under 0.1. Field data (`web-vitals`, the framework's analytics) beats lab data.
- Use the React DevTools Profiler with "Highlight updates when components render" to find re-render storms. Find the cause before adding memoization.
- In the Performance panel, long tasks over 50ms on the main thread are what make interactions feel delayed. Break them up or move them off the main thread (Web Worker, `scheduler.yield()`, `requestIdleCallback`).
- Measure before and after every optimization. A change that doesn't move a number is complexity without benefit.

## Checklist

- [ ] Lists that are unbounded or can exceed 200 rows are virtualized or paginated
- [ ] No per-frame `setState`; contexts split by update frequency; derived values computed in render
- [ ] Heavy, rarely used UI is code-split with a sized fallback; no namespace imports of large libraries
- [ ] Content routes (blog, docs, changelog, pricing) are statically generated
- [ ] Images and video declare dimensions; served at displayed size in WebP/AVIF; hero prioritized, rest lazy
- [ ] Fonts are woff2, subset, limited to used weights, preloaded with `crossorigin`, fallback metrics matched
- [ ] Search debounced ~300ms with stale requests aborted; scroll listeners passive
- [ ] Optimistic updates roll back visibly on failure
- [ ] Feedback within 100ms; indicator after 400ms; spinner delayed ~150ms
- [ ] Off-screen loops, video, and polling paused
- [ ] Measured on a real mid-range phone against a production build
