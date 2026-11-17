# Design Foundations

Core visual judgment for any interface: hierarchy, spacing, layout, information architecture, navigation, button hierarchy, icons and illustrations, empty states, and UI copy, written as paired right/wrong calls. Read it when building or reviewing a screen's structure, when a UI "looks off" without an obvious cause, or after generating a screen that may look AI-made. Type, color, and surfaces have their own files: [typography.md](typography.md), [color.md](color.md), [surfaces.md](surfaces.md).

## Working rules

- **Match the project's styling system.** Detect whether the codebase uses Tailwind, plain CSS, CSS Modules, CSS-in-JS, or something else, and write every fix in that idiom. A design fix never justifies adding a second styling approach.
- **Small details compound.** A half-pixel icon, a proportional price column, or a border that sits on top of its surface is invisible on its own. Fifty of them make a product feel cheap. Treat each call below as load-bearing.
- **Exceptions are named.** Where a rule below states when it doesn't apply, follow that exception exactly. Everywhere else the rule holds.
- **Review with fresh eyes.** Flaws that are invisible at the end of a build session are obvious the next day. When possible, re-check after a break.

### Reporting a review

Present findings as one markdown table with `| Before | After | Why |` columns, one row per issue, and a one-line reason in the Why column. Don't use stacked "Before:/After:" lists. Stay silent on rules the UI already follows.

## Core principles

1. **One primary action per view.** If three buttons carry equal visual weight, none of them is the next step. Demote to primary, secondary ghost, text link.
2. **Hierarchy is subtraction.** Make the important thing prominent by making everything else recede. Making everything louder produces no hierarchy at all.
3. **Restraint reads as intent.** Fewer colors, fewer font weights, one icon library, three illustration colors instead of six. A limited palette looks decided; a full one looks indecisive.
4. **Specific beats generic.** "Save changes" beats "Submit". "Your email must include an @ symbol" beats "Invalid input".
5. **Space with a system.** `gap` over per-child margins, paragraph spacing tied to line-height, line length capped near 65ch, inner radius derived from outer radius.
6. **Every state is designed.** Default, hover, focus, active, disabled, loading, empty, error. Each is visually distinct.
7. **Accessibility is a floor.** Focus rings, labels wired to inputs, real `<button>` elements, color plus icon plus text for errors. Never deferred to a polish pass.

## Hierarchy and spacing

- **Space by relationship, never evenly.** The closer two elements belong together, the smaller the gap. An eyebrow sits about 8px from its heading, the heading about 16px from its lede, and the intro ends 24px or more before the content starts. Equal gaps fuse a header into one undifferentiated block.
- **Wrong:** paragraph spacing set to an arbitrary 12px. **Right:** paragraph spacing equal to 1× the line-height, so vertical rhythm stays consistent.
- **Wrong:** `margin-bottom` on every child. **Right:** `gap` on the parent. Margin leaves a trailing gap after the last item and bleeds past the component boundary; `gap` stays contained.
- **Wrong:** "Delete" placed directly beside "Confirm". **Right:** destructive actions separated by whitespace and a visual break. Proximity implies equivalence.
- **Wrong:** a heading with a caption under it that restates the heading. **Right:** the heading alone. Every element that repeats another dilutes both.
- **Neighboring sizes must differ at a squint.** A page title sits well above its lede (about 1.75× or more) and adds weight. If a role drops weight, it needs more size to compensate. Details in [typography.md](typography.md).

## Layout and grids

- **Wrong:** a container with no max-width on a wide monitor. **Right:** content capped (around 1200px) and centered. Uncapped layouts produce unreadable lines and sparse, drifting compositions.
- **Wrong:** breakpoints at 768px and 1024px because those are device sizes. **Right:** breakpoints where the content actually breaks. Device-named breakpoints miss the real failure point.
- **Wrong:** a 12-column grid for a simple marketing page. **Right:** 8 columns or fewer. Twelve adds configuration overhead with no benefit at simple layouts.
- **Wrong:** a baseline grid on a dense product dashboard. **Right:** baseline grids only in long-form editorial layouts. In product UI, mixed control heights make the grid fight every component.
- **Wrong:** a two-column layout that mirrors left and right equally. **Right:** one wider column offset by a narrower one. Asymmetry creates tension and interest. Symmetry the content didn't ask for reads as a template.
- **Wrong:** an 80px sticky header on a 667px landscape phone viewport. **Right:** a header constrained with `max-height` in `dvh` units, so content keeps its room.
- **Wrong:** a fixed bottom CTA on mobile that covers the last form field. **Right:** padding that accounts for `env(safe-area-inset-bottom)`.
- **Wrong:** text overlaid directly on a full-bleed image. **Right:** text in a column beside or below the image. An overlay needs a scrim, color matching, and contrast checks; the column just works. Default to it.
- **Wrong:** inner card reusing the parent's border radius. **Right:** inner radius = outer radius − padding. See [surfaces.md](surfaces.md).

## Information architecture and navigation

- **Wrong:** forty settings on one flat scrolling page. **Right:** grouped with a sidebar nav and progressive sections. A flat list buries everything equally.
- **Wrong:** a toggle labeled "Enable async relay mode". **Right:** "Send messages in the background". Name things by the user's mental model, never internal jargon.
- **Tabs are for views of the same thing.** "This week / This month / This year" is the textbook use. Separate destinations ("Account / Billing / Notifications") are navigation and get a sidebar or nav links with their own URLs.
- **Wrong:** three levels of nested dropdowns. **Right:** a flatter structure, with breadcrumbs where depth is unavoidable. Deep nesting makes people lose track of where they are.
- **Search data is IA feedback.** If users keep searching "invoices" while the nav says "Billing", rename the nav item.
- **Wrong:** onboarding that tours eight features before the user can do anything. **Right:** onboarding that creates the user's first item in one step. The tour teaches the product; the shortcut delivers value.
- **Wrong:** the primary action buried at the bottom of a long page. **Right:** the primary action anchored persistently in view. Most users never scroll to the bottom.
- **Wrong:** an error page with "Something went wrong" and a back button. **Right:** an explanation of what went wrong plus a specific recovery action. The generic version ends the journey.
- **Confirmation dialogs describe what will be lost.** "Delete 'Q3 report'? This removes 14 comments." beats "Are you sure?". Keep the destructive and safe buttons visually apart.

## Buttons and components

- **Wrong:** three equally weighted primary buttons in a row. **Right:** one primary, one secondary ghost, one text link. Equal weight means no clear next action.
- **Wrong:** a floppy-disk icon alone for "save". **Right:** a labeled "Save" button. Ambiguous metaphors need text.
- **Wrong:** an input that looks identical in default, hover, focus, and error. **Right:** each state visually distinct, so users can tell active from broken.
- **Badge vs tag.** A badge implies a count; a tag implies a category. A "New" feature marker is neither and needs its own treatment.
- **Wrong:** a tooltip containing a "Learn more" link. **Right:** a click-triggered popover. Tooltips can't hold interactive elements; the link is unreachable.
- **Wrong:** zebra striping on a table with misaligned number columns. **Right:** right-aligned tabular numbers, no stripes needed. Fix alignment before adding stripes.
- **Wrong:** a whole card wrapped in one `<a>`. **Right:** the card with a distinct CTA link. A full-card link kills text selection and screen readers announce the whole card as one link.
- **Wrong:** success shown in green when green is also the primary brand color. **Right:** a distinct confirmation color, so "primary action" and "it worked" stay distinguishable.
- **Wrong:** a disabled state made with `opacity: 0.4`. **Right:** a dedicated muted color token. Opacity passes contrast on some backgrounds and fails on others; a token is predictable.

Interaction details (hover affordance, pressed states, optimistic updates, debouncing, copy confirmation, toast lifetimes) live in [interaction-details.md](interaction-details.md). Focus, labels, hit areas, and screen-reader rules live in [touch-accessibility.md](touch-accessibility.md). Motion timing lives in [animation-principles.md](animation-principles.md).

## Empty and error states

- **Wrong:** "No projects found". **Right:** "You haven't created a project yet" with a "Create project" button. Say why it's empty and what to do next.
- **Distinguish first-use empty from filtered empty.** "No results for 'invoce'. Check the spelling or clear filters" is a different state from a brand-new account, and needs its own copy and action.
- **Errors carry three signals.** Red border, error icon, and message text. Color alone is invisible to colorblind users.
- **Errors sit next to their cause.** Inline next to the field, never stacked above the form where users have to hunt.

## UI copy and microcopy

- **Wrong:** "Submit". **Right:** the specific outcome, "Save changes". Specificity builds trust.
- **Wrong:** "Invalid input". **Right:** "Your email must include an @ symbol". Name the problem and how to fix it.
- **Wrong:** a placeholder as the only label. **Right:** a persistent label above the field. The placeholder disappears the moment typing starts, right when the reminder is needed.
- **Wrong:** Title Case Throughout The Whole Product. **Right:** sentence case. Title case on long labels reads like a legal document.
- **Wrong:** "Your export is complete and ready for download from the exports section of your account". **Right:** "Export ready. Download". Front-load the important word.
- **Wrong:** "Please confirm your selection before proceeding". **Right:** "Confirm". Drop "please" from imperative UI copy.
- **Wrong:** a headline any product could run ("Build faster. Ship smarter."). **Right:** a line only this product could say. If a competitor could paste it unchanged, rewrite it.
- **Casing lives in CSS.** Store strings in sentence case and apply `text-transform` for all-caps labels. See [typography.md](typography.md).

## Icons

- **One library per product.** Never mix two icon sets on one surface, even similar ones. Stroke weight and corner-radius differences compound across a card set.
- **Thin strokes as icons shrink.** Don't reuse a 24px icon's stroke at 16px; thin it to match the scale, or the small version looks heavy.
- **Snap to the pixel grid.** A 1px stroke on an axis-aligned edge sits on a half-pixel coordinate (`x.5`); a 2px stroke sits on a whole one. Strokes that straddle the grid blur on 1x screens.
- **Below about 12px, swap to filled.** 1px-stroke icons disappear at tiny sizes.
- **Active/selected:** follow the product's existing outlined-vs-filled convention. With none, use outlined at rest and filled when active. Mixing conventions across screens is the mistake.
- **Optical over mathematical centering.** A play triangle centered mathematically in a circle looks left-heavy; nudge it about 1px right.
- **Don't scale icons up.** A 16px icon scaled to 48px gets a clumsy 3× stroke (or a spindly one under `vector-effect: non-scaling-stroke`). Use the set's larger size or redraw with a stroke chosen for that size.
- **Round caps by default.** Square stroke caps read as unfinished in most UI.
- **Union multipath icons** into one path with one fill. Multiple fills mean multiple things to restyle and theme.
- **Match icon weight to adjacent text.** A thin icon beside bold text looks like a mistake.
- **Give icon-plus-label buttons a 6–8px gap.** Without it they look collided.
- **One icon, one meaning.** If a chevron means both "expand accordion" and "next page", users learn neither. Use a distinct arrow for navigation. Don't use the star for both favorite and rating; use a heart for favorite.
- **Rotation alone doesn't distinguish.** Upload/download icons that differ only by 180° need a second signal, especially for colorblind users.
- **Alert shapes:** exclamation in a circle for info/neutral, in a triangle for warning. If the design system maps them differently, follow it and don't mix.
- **Favicons get a simplified mark** pixel-hinted for 16px. A full logo at favicon size is mush.
- **Icons in SVG use `currentColor`** so they follow text color across themes.

## Illustrations

- **Match the icon system's stroke weight.** 2px illustration strokes beside 1px icons look like two products.
- **Keep perspective consistent** within a scene. One-point perspective mixed with a three-quarter-view character reads as uncanny.
- **Recolor stock packs** to the UI's tokens. Dropped in with their own palette, they look bolted on.
- **Match complexity to context.** A tooltip gets a spot illustration, never a narrative scene.
- **Skip the generic blob-and-character style.** It signals no budget or thought. A typographic treatment, or no illustration, beats it.
- **Design negative space into the illustration.** Whitespace forced around it afterward looks like clip art.
- **Don't scale illustrations up.** At 3× the intended size, strokes go thick and detail turns coarse. Redraw.
- **Limit to about 3 colors.** Six colors from across the brand reads as indecisive.
- **Match the UI's light direction.** Opposing shadow directions create a subliminal wrongness.

## Generic and AI-looking design tells

Nobody points at one element that makes a screen look generated. They recognize the accumulation: each choice is the statistically common default, and fifty defaults compound into a recognizable look. Run this pass on any generated interface.

### The pass

1. **Squint test.** Could this screen belong to any of ten thousand products? If the only thing tying it to this product is the logo, everything else is up for review.
2. **Subtract first.** Walk every element (icon, line, badge, caption, container, word) and ask what breaks if it's gone. If nothing, delete it. "Adds visual interest" and "fills the space" are not answers. Run the walk twice; deletions expose each other.
3. **Sweep what's left in order:** color, typography, layout, decoration, iconography, copy, motion. Color first because it is the loudest tell.
4. **Put a point of view back in** (below). A screen scrubbed of tells with no opinionated choice is still generic.
5. **Final read.** Ask what would make a designer suspect a model built this, fix it, and repeat until nothing is left. Then name the one choice a competitor couldn't copy. If nothing answers, the pass isn't done.

### Tells and their fixes

| Tell | Fix |
| --- | --- |
| Unchosen indigo/violet (`bg-indigo-500`) as the brand | Derive a palette from the product's domain, brand, or content (see [color.md](color.md)). Purple is fine when chosen |
| Several gradients per screen: hero wash, gradient border, gradient text | At most one gradient, with a job, built from the chosen palette and eased (see [surfaces.md](surfaces.md)) |
| Dark-by-default with neon glows | Choose the default theme from where and when the product is used |
| Gradient headline (`bg-clip-text text-transparent`) | Solid color with real contrast |
| Inter at `font-black tracking-tight`, centered, by default | One deliberate typographic decision per project (see [typography.md](typography.md)) |
| Pill badge, centered headline, one-line subhead, two buttons, orb behind | Lead with the real product (screenshot, live demo), left-align long copy, cut the badge unless there's a real announcement |
| Three cards with icon, title, two lines; or a bento grid sized before content existed | Let content dictate form: one key feature gets full width with a screenshot, six small ones get a compact list, unequal features get unequal space |
| `backdrop-blur` frosted card over a flat background | Use glass only when there is meaningful content behind it |
| Blurred orbs and animated blobs behind the hero | Delete them. If the page feels empty, the foreground content is too weak |
| Border, shadow, ring, and gradient on one card; `rounded-2xl` everywhere | One depth cue per surface; radii from a scale, nested radii derived |
| Emoji as feature icons (🚀⚡🔒✨) | One real icon set at one stroke width, or no icons |
| ✨ sparkle badge on every AI feature | Copy that says what the feature does |
| "Trusted by 10,000+ developers", stock-avatar testimonials, logo walls without permission | Real numbers and real named quotes, or cut the section |
| Every section fades up on scroll; `hover:scale-105` on non-clickable cards | No scroll entrances on static marketing content; no hover response on non-interactive elements |

### Looking designed by someone

- **Derive the palette from something real:** the domain, an existing brand artifact, the content's own colors.
- **Make one distinctive type decision:** a display face with a point of view, an unusual size contrast, or a deliberate pairing. One is enough.
- **Show the actual product:** real screenshots, real data, a working embed.
- **Let content break symmetry:** an odd number of features, one oversized item, a section that's a single sentence.
- **Repeat a signature:** one distinctive element (a corner treatment, a rule weight, a motif) used consistently beats ten borrowed ones used once.
- **Restraint is a feature.** The confident version of a screen usually has fewer effects than the generated one. Adding "personality effects" on top re-adds slop.

## Checklist

- [ ] Exactly one visually primary button per view; others demoted to ghost or text link
- [ ] Gaps graded by relationship; siblings spaced with parent `gap`, not per-child margins
- [ ] Content containers capped on wide screens; breakpoints set where content breaks
- [ ] Destructive actions separated from safe ones; confirmations say what will be lost
- [ ] Labels use the user's words; tabs only for views of the same thing
- [ ] Empty states explain why and offer the next action; errors are inline with icon and text
- [ ] Button labels name the outcome; sentence case; no "please"; no placeholder-as-label
- [ ] One icon library, pixel-snapped, stroke matched to size and adjacent text, optically centered
- [ ] Illustrations limited to ~3 colors, recolored to tokens, matched to icon stroke and light direction
- [ ] Subtraction pass done: every remaining element breaks something if removed
- [ ] No unchosen indigo, gradient text, emoji icons, decorative orbs, or fabricated social proof
- [ ] At least one deliberate choice a competitor couldn't copy
