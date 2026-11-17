# Marketing Pages

Landing pages, heroes, social proof, pricing, blogs, docs sites, changelogs, metadata, Open Graph images, and the performance and motion rules specific to pages a stranger sees first. Read it when building or reviewing any public, crawlable, shareable page. These pages get one visit to make their case, so the failures are different from product UI: the link preview with no image, the page that performs at the visitor instead of answering them, the blog fetched from a CMS on every request.

## Core principles

1. **Motion maps to user input.** No fade-up on every section, no scroll hijacking, no parallax that isn't 1:1 with scroll, no auto-advancing carousels. If the user didn't cause it, cut it.
2. **Intro animations play once per session.** Gated before first paint, so returning visitors never see a flash.
3. **Pre-render everything.** Blog, docs, changelog, pricing: build time plus revalidation, never request-time fetching.
4. **Kill layout shift at the source.** Preload fonts and the hero image; reserve space for all media.
5. **Content lives in the DOM.** Hover-revealed nav submenus are visually hidden, not mounted on hover.
6. **CTAs know who's looking**, and the conversion path works end to end.
7. **Every claim is real.** No invented stats, testimonials, or logos.
8. **Every route has metadata and a link preview.**

## Motion budget

Marketing pages earn more animation than product UI. A visitor sees a landing page once, not a hundred times a day, and the page is the packaging of the product. Longer durations, one-shot intros, explanatory animations, and easter eggs are legitimate here and not in the product. The budget is still small, and most sites overspend it.

### Allowed

- **A one-shot intro** on the hero: staggered headline, subhead, CTA, product shot. Up to four blocks at ~100ms apart; varied timing lets the eye read in order. Gate it per session (below).
- **Explanatory animation** that replaces a static asset: a looping demo of the product doing its job, an animated diagram. Pause it off-screen.
- **Scroll-linked effects that map 1:1 to scroll position** (scrubbed progress, a sticky section whose state follows the scrollbar). Scrolling back reverses them.
- **A single deliberate reveal** where the reveal itself carries meaning, such as a `clip-path: inset()` wipe on a key product image. Implementation in [animation-gestures-scroll.md](animation-gestures-scroll.md).
- **Interactive demos** the visitor can touch: drag, hover, toggle. These are the best kind of motion on a marketing page, because the visitor causes them.
- **Hover and press feedback** on cards and buttons, same rules as product UI (1–2% hover scale, `scale(0.97)` press, gated hover).

### Not allowed

- Scroll-triggered fade-ups or slide-ins on every section as it enters the viewport.
- Scroll hijacking: `wheel` listeners with `preventDefault`, `scroll-snap` on the page itself, smooth-scroll libraries that replace native scroll.
- Parallax that does not map 1:1 to scroll.
- Auto-advancing carousels. If one exists and the design insists on it, it needs a visible pause control (a WCAG requirement) and must stop under reduced motion.

All of these move without the user asking, and the page feels like it is performing at the visitor. Scroll-triggered reveals also hide content from anyone who scrolls fast, prints, or arrives before JavaScript loads.

### The resting state is visible

Content's default style is its visible end state. Animation starts from there, never the reverse.

```css
/* Wrong: content is invisible until JS runs and an observer fires */
.section { opacity: 0; }
.section.in-view { opacity: 1; }

/* Right: visible by default; motion only when it's allowed */
@media (prefers-reduced-motion: no-preference) {
  html.js .section:not(.in-view) { opacity: 0; transform: translateY(8px); }
}
```

Content stuck at `opacity: 0` when the observer never fires (no JS, reduced motion, print, a fast scroll) is a defect, not a style choice.

### Intro once per session

Use `sessionStorage`, not `localStorage`: the intro plays again on a new visit, but not on every internal navigation back to the homepage. Read the flag before paint. Reading it in `useEffect` runs after the first frame, so a returning visitor sees the intro start and then snap.

```tsx
// app/layout.tsx: blocking inline script sets an attribute before paint
<html lang="en" suppressHydrationWarning>
  <head>
    <script
      dangerouslySetInnerHTML={{
        __html: `try{sessionStorage.getItem("hasSeenIntro")?document.documentElement.setAttribute("data-intro-seen",""):sessionStorage.setItem("hasSeenIntro","1")}catch(e){}`,
      }}
    />
  </head>
  <body>{children}</body>
</html>
```

```css
/* Plays only when the flag wasn't set before paint; the hero's base style is its visible end state */
html:not([data-intro-seen]) .hero {
  animation: hero-in 300ms var(--ease-out) both;
}
```

```tsx
// In a client component: once it has played, set the attribute so client-side navigation back doesn't replay it
<section
  className="hero"
  onAnimationEnd={(e) => {
    if (e.target === e.currentTarget) document.documentElement.setAttribute("data-intro-seen", "");
  }}
>
```

### Reduced motion still applies

Under `prefers-reduced-motion: reduce`, intros become a short fade or nothing, marquees and logo tickers stop, autoplaying video shows a poster with controls, and animated GIFs swap to a static frame via `<picture>`. See [animation-performance-accessibility.md](animation-performance-accessibility.md).

## Hero

The hero is the LCP element and the first thing that can go wrong.

- **The headline says what the product does**, in the visitor's words. One `<h1>` per page.
- **One primary CTA**, optionally one quieter secondary (a text link or ghost button). Two equal-weight buttons means no clear next step.
- **Show the real product.** A screenshot, a live component, or a short loop beats an abstract illustration.
- **Height**: `min-height: 100svh`, never `100vh` (overflows behind the URL bar) or `100dvh` (shifts as the bar collapses).
- **Headline wrapping**: `text-wrap: balance`. Check it at 375px wide, where a long word at display size overflows the viewport.
- **No shift**: hero font preloaded, hero image preloaded with dimensions (see Performance).
- **No glow that steals clicks**: decorative gradients, glows, and noise layers over the CTA get `pointer-events: none`.
- **Generated-looking tells to avoid**: indigo-to-purple gradient heroes, gradient headline text, glass cards over nothing, a three-card grid of emoji features, sparkle icons meaning "AI".

## Social proof

- **Every number, quote, and logo has a source.** "Trusted by 10,000+ teams", a five-star quote from "Sarah K., Product Lead", a logo wall of companies that aren't customers, "99.9% uptime", "SOC 2 compliant": invented proof is a false claim on a live site, and the compliance ones are legal exposure. Never write placeholder proof. Leave the section out and flag it.
- **Testimonials carry a real name, role, company, and photo.** An anonymous quote reads as fabricated even when it isn't.
- **Logo walls** normalize logos to one color (usually the muted foreground) and a consistent optical size, not a consistent pixel height; wide wordmarks need less height than square marks. Use SVGs with `currentColor` so they flip in dark mode.
- **A marquee of logos** runs `linear`, pauses on hover, stops under reduced motion, and duplicates its content with `aria-hidden="true"` on the copy so screen readers don't read the list twice.

## Pricing pages

- **Prices on the page match the billing config.** Hardcoded price strings drift from the checkout. Read both from one source.
- **The plan the button names is the plan checkout opens.** No test-mode payment links (`buy.stripe.com/test_`, sandbox URLs) in production.
- **Numbers use `font-variant-numeric: tabular-nums`**, so a monthly/yearly toggle doesn't shift the layout as digits change. Reserve width for the longest price.
- **State the currency and billing period** next to every price ("$12 / month, billed yearly"). Show what yearly saves as a concrete amount.
- **Highlight at most one plan.** Recommended-plan styling on two cards cancels out.
- **CTA labels name the outcome**: "Start free trial", "Choose Pro", "Contact sales", not "Submit" or "Buy".
- **Feature comparisons are a real `<table>`** with row headers, so they read correctly to screen readers and scroll horizontally inside a wrapper on mobile.
- **Put the FAQ on the pricing page**: refunds, seat changes, cancellation. These are the questions blocking the purchase.

## Calls to action

CTAs adapt to auth state. A logged-in user told to "Sign up" hits a dead end, or a signup form that errors.

| State | CTA |
| --- | --- |
| Logged out | "Get started" or "Sign up" |
| Logged in | "Go to dashboard" or "Open app" |

```jsx
<Button href={isLoggedIn ? "/dashboard" : "/signup"}>
  {isLoggedIn ? "Go to dashboard" : "Get started"}
</Button>
```

Resolve this on the client so the page stays static. Reading `cookies()` or `headers()` in a marketing layout to choose the CTA opts the whole subtree out of static rendering.

### The conversion path works end to end

Landing → CTA → signup or checkout → first screen. Every link resolves, prices match, the post-signup redirect lands somewhere that exists, `mailto:` and social links have real handles, and waitlist and newsletter forms post somewhere. Footer columns and social icons are where `href="#"` placeholders hide.

## Header navigation

Submenu content that appears on hover must exist in the DOM at all times, visually hidden rather than mounted on hover. Crawlers, screen readers, and touch users need the real markup.

```html
<nav>
  <button aria-expanded="false" aria-controls="products-menu">Products</button>
  <div id="products-menu" class="submenu" hidden>…full content…</div>
</nav>
```

- `{isOpen && <Submenu />}` in a marketing header is the bug.
- Every submenu opens on click and keyboard focus too, not only `onMouseEnter`.
- Hover-intent: a short delay (~100–150ms) before opening and a forgiving path toward the submenu, so diagonal mouse travel doesn't close it. See [interaction-details.md](interaction-details.md).

## Documentation sites

- **Copy button on every code snippet**, and it confirms: swap to a checkmark for ~1.5s. Without feedback users click it three more times.
- **Every page is available as markdown**: a "Copy as Markdown" button, plus `.md` URLs (`/docs/getting-started.md` returns raw markdown). This serves people and the LLMs reading the docs.
- **Visual examples everywhere.** Code alone isn't enough; show what the code produces, and let the reader touch it when possible.
- **Headings are linkable**: an anchor link on hover/focus, plus `scroll-margin-top` equal to the sticky header's height so targets don't land under it.
- **Search is reachable from the keyboard** (`⌘K` / `Ctrl K`, with the right modifier shown per platform).
- **Syntax highlighting follows the theme**: one theme per color scheme (Shiki `themes: { light, dark }`).

## Blog and changelog

- **RSS feeds** at predictable paths, linked from `<head>`:

  ```html
  <link rel="alternate" type="application/rss+xml" title="Blog" href="/blog/rss.xml" />
  <link rel="alternate" type="application/rss+xml" title="Changelog" href="/changelog/rss.xml" />
  ```

- **Dates in `<time datetime="2026-11-14">`**, formatted with `Intl.DateTimeFormat`.
- **Headings balance, paragraphs don't strand a word:**

  ```css
  article h1, article h2 { text-wrap: balance; }
  article p { text-wrap: pretty; }
  ```

- **Body copy caps near 65ch.** A paragraph running the full width of a 1440px screen is work to read. Typography details in [typography.md](typography.md).
- **Changelog entries** each have a date, an anchor, and a visual of the change when it's visible.

## Metadata and SEO

Every public route has a title and description. A page with no `<title>` shows its URL in the tab, in search results, and in every link preview. The framework default ("Create Next App", "Vite + React") is worse.

```tsx
// app/layout.tsx
export const metadata: Metadata = {
  metadataBase: new URL("https://example.com"),
  title: { default: "Product", template: "%s · Product" },
  description: "…",
};
```

```tsx
// app/blog/[slug]/page.tsx
export async function generateMetadata({ params }) {
  const post = await getPost((await params).slug);
  return { title: post.title, description: post.excerpt };
}
```

- **Without `metadataBase`, relative OG image URLs resolve to `localhost` in production.**
- Take the title from the page's `<h1>` and the description from existing copy (the hero subhead, the post excerpt). Never invent marketing copy to fill a field; flag it.
- Dynamic routes use `generateMetadata`, not one static title for every post.
- `<html lang>` is set to the content's real language.
- **Crawling**: `robots.txt` exists and has no leftover `Disallow: /` from staging; no site-wide `noindex` left on; `sitemap.xml` lists real pages and excludes `/proto`, `/lab`, and auth-gated routes; `<link rel="canonical">` on pages reachable at more than one URL. A leftover `Disallow: /` or `noindex` de-indexes the whole site.
- **Favicon and icons are the product's**: an SVG favicon, a PNG fallback, a 180×180 `apple-touch-icon` (without it iOS uses a page screenshot on the home screen). Check the favicon on a dark tab bar.
- **Structure is real**: one `<h1>`, heading levels that don't skip, `<main>`, `<nav>`, `<footer>`. The headline and body copy are in the server-rendered HTML, not injected by client JavaScript.

## Open Graph images

Launch day is people pasting the link into Slack, X, iMessage, and LinkedIn. With no OG image the link is a bare URL; with a broken one it's a grey box.

```tsx
openGraph: { images: [{ url: "/og.png", width: 1200, height: 630 }] },
twitter: { card: "summary_large_image" },
```

- **1200×630**, PNG or JPG, under ~1MB. The image path must exist.
- **Readable as a thumbnail**: large type, few words, high contrast. Previews render small and get cropped toward the center on some platforms; keep text and the logo inside the middle ~80%.
- **Per-page images for blog posts and docs** when the project has a generator (Next.js `opengraph-image.tsx` with `ImageResponse`); otherwise a site-wide image is fine.
- **Never ship a placeholder.** If no OG image exists, flag it.
- Verify by pasting the production URL into Slack and iMessage and looking at the preview.

## Performance

### Static generation

Generate blog, changelog, docs, pricing, and other content pages at build time with revalidation. Never fetch them at request time.

```jsx
export async function generateStaticParams() {
  const posts = await getPosts();
  return posts.map((post) => ({ slug: post.slug }));
}

export const revalidate = 3600; // revalidate every hour
```

Hunt for `dynamic = "force-dynamic"`, `cache: "no-store"` on CMS calls, and `cookies()` / `headers()` in marketing layouts.

### Fonts

Preload the fonts used above the fold so text doesn't reflow when the webfont lands:

```html
<link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin />
```

```jsx
import { preload } from "react-dom";
preload("/fonts/inter-var.woff2", { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
```

`crossorigin` is required even for same-origin fonts; without it the preload is fetched and thrown away. `woff2` only, subset to the alphabets rendered, only the weights used. `next/font` handles preload and fallback metrics.

### Images and media

```html
<link rel="preload" as="image" href="/hero.webp" />
<img src="/hero.webp" width="1200" height="630" alt="…" />
<img src="/feature-3.webp" loading="lazy" decoding="async" width="600" height="400" alt="…" />
```

- Preload or `priority` the hero image only. `priority` on every image is the same as none; `loading="lazy"` on the hero delays the one image that matters.
- Every image, video, and iframe has `width`/`height` or `aspect-ratio`, so the box is reserved before bytes arrive.
- Serve the size shown (`sizes` / `srcset`), WebP or AVIF for photos, SVG for anything drawn.
- Demo videos: `muted playsinline`, a `poster`, `preload="none"` or `"metadata"` below the fold, paused when off-screen.
- Heavy interactive demos (3D, canvas, large charts) load lazily behind a sized placeholder.

### Third-party scripts

- Analytics load once, in the root layout, with `async` / `defer` or the framework's script strategy. Hunt for duplicate snippets and snippets present on only the homepage.
- Cookie banners overlay (`position: fixed` with safe-area padding) and never push content down when they mount, and never cover the mobile CTA. Whether a consent banner is needed is a legal decision; note what tracking exists.
- Chat widgets and embeds load after interaction or idle, not in the critical path.

Measure on the production build with Lighthouse on mobile; read LCP and CLS. More in [performance.md](performance.md).

## Code-built illustrations

Illustrations built from DOM elements need an accessible name, no text selection, and no pointer interference:

```jsx
<div
  role="img"
  aria-label="Illustration showing data flow"
  className="illustration"
  style={{ userSelect: "none", pointerEvents: "none" }}
/>
```

Skip `pointerEvents: "none"` only when the illustration is interactive. Purely decorative ones get `aria-hidden="true"` instead of a label.

## Look at it as a stranger

These can't be verified from code. Run them before launch:

- Open the production URL in a private window on a phone over cellular.
- Paste the URL into Slack, X, and iMessage and check each preview.
- Run Lighthouse against the production build on mobile; read LCP and CLS.
- Click the primary CTA and complete the whole flow with a real card in live mode, then refund it.
- View source and confirm the headline and body copy are in the HTML.
- Read every word on the landing, pricing, and signup pages, and click every header and footer link.

## Checklist

- [ ] No scroll-triggered section reveals, scroll hijacking, non-1:1 parallax, or auto-advancing carousels; content is visible without JS
- [ ] Intro animation gated per session before first paint; reduced motion stops intros, marquees, and autoplay
- [ ] Hero: one `<h1>` that says what the product does, one primary CTA, `min-height: 100svh`, balanced headline checked at 375px
- [ ] Every stat, testimonial, and logo is real and sourced; no placeholder proof
- [ ] Pricing matches the billing config, uses `tabular-nums`, states currency and period; no test-mode checkout links
- [ ] CTAs switch copy and destination by auth state, resolved on the client; the full conversion path works
- [ ] Nav submenu content is in the DOM when closed and opens on click and focus
- [ ] Docs snippets have confirming copy buttons; pages export as markdown; concepts have visual examples
- [ ] RSS for blog and changelog, linked in `<head>`; dates in `<time datetime>`
- [ ] Every route has a title, description, and 1200×630 OG image; `metadataBase` set; robots and sitemap correct; real favicon and `apple-touch-icon`
- [ ] Content routes statically generated; fonts and hero image preloaded; all media has dimensions; analytics loaded once and deferred
- [ ] Code-built illustrations have `role="img"` + `aria-label` (or `aria-hidden`), no selection, no pointer events
