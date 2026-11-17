# Component Design

How to design React component APIs that make the common case a one-liner and the uncommon case possible without forking. Read this when creating or refactoring shared components, reviewing a props API, building on headless primitives, or documenting a design system.

The failure modes are always the same: too rigid (users fork or hack around you) or too configurable (30 props nobody can hold in their head). Reach for composition before configuration, name things the way the platform does, and support both controlled and uncontrolled state when state is involved.

## Composition over configuration

Expose structure as JSX children, not configuration objects.

```jsx
// Right: composable
<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
    <CardDescription>Description</CardDescription>
  </CardHeader>
  <CardContent>Content here</CardContent>
  <CardFooter>
    <Button>Action</Button>
  </CardFooter>
</Card>

// Wrong: configuration object
<Card
  header={{ title: "Title", description: "Description" }}
  content="Content here"
  footer={{ actions: [{ label: "Action", onClick: () => {} }] }}
/>
```

Configuration objects force you to anticipate every shape in advance. Each new requirement becomes a new key, and the consumer can never put something you didn't plan for in the header.

### Prop explosion

```jsx
// Wrong
<Button leftIcon={<Icon />} rightIcon={<Arrow />} iconSpacing={8} iconSize={16}>
  Click
</Button>

// Right: children, with spacing handled by the button's own gap
<Button>
  <Icon /> Click <Arrow />
</Button>
```

### Children, slot props, render props

- **Children** for content the consumer arranges.
- **Slot props** for optional sections that take arbitrary JSX in a fixed position:

```jsx
function Card({ children, header, footer }) {
  return (
    <div className="card">
      {header && <div className="card-header">{header}</div>}
      <div className="card-content">{children}</div>
      {footer && <div className="card-footer">{footer}</div>}
    </div>
  );
}

<Card header={<h2>Title</h2>} footer={<Button>Save</Button>}>
  Main content
</Card>
```

- **Render props** when the component owns data and the consumer decides how each piece renders:

```jsx
<List items={users} renderItem={(user) => <UserCard user={user} />} />
```

## Compound components

When a component has multiple related parts that share implicit state, split it into parts instead of prop-drilling everything through one root.

```jsx
// Right
<Dialog>
  <Dialog.Trigger>Open</Dialog.Trigger>
  <Dialog.Content>
    <Dialog.Title>Are you sure?</Dialog.Title>
    <Dialog.Description>This action cannot be undone.</Dialog.Description>
    <Dialog.Close>Cancel</Dialog.Close>
  </Dialog.Content>
</Dialog>

// Wrong
<Dialog
  trigger="Open"
  title="Are you sure?"
  description="This action cannot be undone."
  closeText="Cancel"
/>
```

Use compound components when:
- Multiple related elements share implicit state (open, selected value, active item).
- The component has slots (header, body, footer).
- The order or presence of children varies between usages.

Don't use them when the component has a fixed structure, 1–3 props, or a structure that never changes. A `Badge` doesn't need `Badge.Label`.

### Implementation: context, root provides, parts consume

```jsx
const DialogContext = createContext(null);

function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("Dialog parts must be rendered inside <Dialog>");
  return ctx;
}

function Dialog({ children }) {
  const [open, setOpen] = useState(false);
  return (
    <DialogContext.Provider value={{ open, setOpen }}>
      {children}
    </DialogContext.Provider>
  );
}

function DialogTrigger({ onClick, ...props }) {
  const { setOpen } = useDialog();
  return (
    <button
      type="button" // inside a <form>, the default "submit" would submit it
      {...props}
      onClick={(event) => {
        onClick?.(event); // compose the consumer's handler; a spread must not replace ours
        if (!event.defaultPrevented) setOpen(true);
      }}
    />
  );
}
```

- Throw a clear error when a part is used outside its root. A silent `null` context produces confusing crashes three calls later.
- Compose event handlers: call the consumer's handler first, then run internal behavior unless it called `preventDefault()`. Put `{...props}` before your own `onClick` so the spread can't overwrite it.

## Customization layers

```jsx
// Too rigid
<Button>Click me</Button>

// Too flexible
<Button backgroundColor="#000" hoverBackgroundColor="#333" borderRadius={4}
  paddingX={16} paddingY={8} fontSize={14} fontWeight={500} /* ...30 more */>
  Click me
</Button>

// Right: variants plus an escape hatch
<Button variant="primary" size="md" className="custom-override">Click me</Button>
```

Layer customization in this order:
1. **Variants**: a closed set of predefined options (`primary`, `secondary`, `destructive`).
2. **Size**: predefined sizes (`sm`, `md`, `lg`).
3. **`className`**: escape hatch for one-off overrides, merged last so it wins (`cn(buttonVariants({ variant, size }), className)`).
4. **`asChild`**: render as a different element.

Express variants in the project's existing styling system (Tailwind with `cva`, CSS Modules, vanilla-extract, styled-components). Don't introduce a new one for one component.

### Variants, not boolean soup

```jsx
// Wrong: invites invalid combinations like <Button primary secondary>
<Button primary large rounded>Click</Button>

// Right
<Button variant="primary" size="lg" radius="full">Click</Button>
```

Type variants as string unions. The union is the source of truth for what exists, and the compiler rejects invented ones.

## Naming props

Mirror HTML and stay consistent across every component.

```jsx
// Right
<Input disabled />
<Button disabled />
<Select disabled />

// Wrong
<Input disabled />
<Button isDisabled />
<Select readonly />
```

- Booleans get positive names: `disabled`, `open`, `required`. Never `notEnabled` or `isNotClosed`.
- Event handlers start with `on`: `onChange`, `onBlur`, `onOpenChange`, `onValueChange`. Never `handleChange` or `blurHandler` as a prop name.
- State pairs follow one pattern everywhere: `value` / `defaultValue` / `onValueChange`, `open` / `defaultOpen` / `onOpenChange`, `checked` / `defaultChecked` / `onCheckedChange`.
- Name things for what they mean, not their structure: `items`, `selectedId`, `retryDelayMs`. Avoid `data`, `config`, `options` for props with one shape.

## Controlled and uncontrolled

Every stateful component works both ways: internal state by default, external state when the consumer passes `value`.

```jsx
function Input({ value: controlledValue, defaultValue, onChange, ...props }) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");

  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : internalValue;

  function handleChange(e) {
    if (!isControlled) setInternalValue(e.target.value);
    onChange?.(e);
  }

  return <input {...props} value={value} onChange={handleChange} />;
}

// Uncontrolled
<Input defaultValue="hello" />

// Controlled: onChange receives the event, not the value
<Input value={value} onChange={(e) => setValue(e.target.value)} />
```

- Decide controlled vs uncontrolled once, on mount. Switching between them mid-life is a bug; warn in development if `value` goes from defined to `undefined`.
- For non-input components, the callback receives the value directly (`onOpenChange(open)`, `onValueChange(value)`), because there is no native event to forward.
- Uncontrolled is the default because most usages don't need to own the state. Controlled is for syncing with the URL, a form library, or another component.

## Play nice with the DOM

### Pass refs through

Every component that wraps a DOM element passes its ref through. Without it, focus management, tooltips, and popover positioning break for anyone composing it. In React 19+, `ref` is a plain prop:

```tsx
function Button({ ref, ...props }: React.ComponentProps<"button">) {
  return <button ref={ref} type="button" {...props} />;
}
```

`forwardRef` is only for React 18 and earlier:

```tsx
const Button = forwardRef<HTMLButtonElement, ButtonProps>((props, ref) => (
  <button ref={ref} type="button" {...props} />
));
```

### Spread remaining props

Destructure what you use and spread the rest onto the root element so `aria-*`, `data-*`, `id`, and test attributes pass through. Type props as `React.ComponentProps<"button">` plus your own, so consumers get every native attribute.

```jsx
function Button({ variant, size, className, ...props }) {
  return (
    <button
      type="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

<Button type="submit" data-testid="submit" aria-describedby="hint">Submit</Button>
```

### Defaults that cover 80% of usages

```jsx
function Button({ variant = "secondary", size = "md", type = "button", ...props }) {}
```

`type="button"`, never `"submit"`: a native button defaults to submit inside a form, so an unmarked "Cancel" submits it. The default variant is the least prominent one that's commonly used; when `primary` is the default, every button becomes primary and the screen loses its hierarchy.

## `asChild` and polymorphism

Let consumers swap the rendered element while keeping behavior and styles:

```jsx
<Button>Click me</Button>

<Button asChild>
  <a href="/page">Click me</a>
</Button>

<Button asChild>
  <Link href="/page">Click me</Link>
</Button>
```

```jsx
import { Slot } from "@radix-ui/react-slot";

function Button({ asChild, ...props }) {
  const Comp = asChild ? Slot : "button";
  // a native button defaults to submit; the child keeps its own semantics
  return <Comp {...(!asChild && { type: "button" })} {...props} />;
}
```

`Slot` merges props, refs, `className`, and event handlers onto the single child. Prefer `asChild` over an `as` prop: `as` makes the prop types depend on the element and gets messy to type, while `asChild` lets the child keep its own fully typed props. Base UI uses a `render` prop for the same job; follow whichever convention the project's primitives already use.

Navigation is a link, actions are buttons. A `<Button>` that navigates should render an `<a>` via `asChild`, not a `<button>` with `router.push`, so it supports middle-click, cmd-click, and the status bar URL.

## Data attributes for state

Expose internal state as data attributes on the rendered element so consumers style states without extra props or context access:

```jsx
<button
  data-state={open ? "open" : "closed"}
  data-disabled={disabled ? "" : undefined}
  aria-expanded={open}
  disabled={disabled}
/>
```

```css
.trigger[data-state="open"] { background: var(--gray-3); }
.trigger[data-disabled] { opacity: 0.5; }
```

```tsx
<AccordionTrigger className="data-[state=open]:bg-gray-3 [&[data-state=open]>svg]:rotate-180" />
```

- Follow the Radix conventions so they read the same across the system: `data-state="open|closed|checked|unchecked|active|inactive"`, presence-only `data-disabled`, `data-highlighted`, `data-orientation`, `data-side`, `data-align`.
- Pair them with the real ARIA attribute (`aria-expanded`, `aria-selected`, `aria-checked`). Data attributes are for styling; ARIA is for assistive tech.
- `data-state` is also the hook for enter and exit animations (`[data-state="closed"] { animation: fade-out 150ms ease-in; }`).
- Never put state in a class name that consumers must know about (`.is-open`). Class names are styling, not API.

## Headless primitives

Build anything with focus management, keyboard navigation, or positioning on a headless primitive: dialogs, popovers, dropdown menus, selects, comboboxes, tooltips, tabs, accordions, sliders, toasts. Radix, Base UI, and React Aria get focus trapping, roving tabindex, typeahead, collision-aware positioning, dismiss on outside click and Escape, and screen reader semantics right. A hand-rolled dropdown gets most of these wrong.

- Use whichever library the project already has. Don't add a second one for one component.
- Hand-roll only presentational components (Card, Badge, Avatar) and simple stateful ones with no keyboard or positioning concerns.
- Wrap the primitive in your own component that applies styles, defaults, and variants, and re-export the parts. Consumers import your `Dialog`, never the primitive directly, so the design system stays the single source of styling.
- Keep the primitive's prop names and composition in your wrapper. Renaming `onOpenChange` to `onToggle` breaks everyone who knows the library.
- For toasts use Sonner; for mobile drawers and sheets use Vaul.

## When to extract a component

- Don't create a shared component until you've copy-pasted the code 2–3 times. Wait for the pattern to emerge, then extract.
- Don't add an option with one caller passing one value. Build for the current callers; generalize on the second real use.
- Before adding a utility or component, search the codebase for the existing owner of that job. A duplicate formatter or a second `Button` is the most common way a system drifts.
- Replace the old implementation and take its name. No `ButtonV2`, `NewModal`, `EnhancedCard` living beside the original; update the callers instead.
- Wrap complex components in an error boundary so one broken widget doesn't take down the page.

## File structure

```
components/
├── button/
│   ├── button.tsx
│   ├── button.test.tsx
│   └── index.ts
├── card/
│   ├── card.tsx
│   ├── card-header.tsx
│   ├── card-content.tsx
│   └── index.ts
```

```tsx
// components/card/index.ts
export { Card, CardHeader, CardContent } from "./card";
```

Match the project's existing layout and export style over this one.

## Documenting a design system

Tokens and components define what exists. Docs define when to use what. Write them for someone who joined yesterday and can't ask questions, which is exactly what an agent is. Every decision the docs leave out gets replaced by a guess.

- **Inventory the code first.** Every token, component, and variant named in the docs must trace to a file. A documented variant that doesn't exist teaches every future reader to invent it. If there's no system to document (no tokens, ad-hoc styles everywhere), say so and set up tokens and base components first.
- **Structure by size.** One token file and up to 5 components: a single `DESIGN.md`. Bigger: a root file (character of the system in 2–3 sentences plus an index, under 100 lines) and one file per topic (`colors.md`, `buttons.md`), each under 150 lines.
- **Close the set.** List variants and state that nothing else exists: "an unlisted variant is a bug, not an option."
- **Per component, in this order:** when to use it and the named alternative ("Navigation styled as a button is a Link"), which variant applies where and which is the default, one correct and one incorrect example from real code, and a decision tree when a choice has three or more options.

````md
## Button

Use for actions. Navigation styled as a button is a Link. Actions in tight spaces use IconButton.

Variants: `primary`, `secondary`, `danger`. Nothing else exists.

- `danger`: destructive or hard-to-undo actions only.
- `primary`: the single most important action on a screen. One per view.
- `secondary`: everything else. This is the default.

```tsx
// Correct
<Button variant="secondary">Cancel</Button>

// Incorrect: ghost doesn't exist in this system
<Button variant="ghost">Cancel</Button>
```

Is it destructive, or hard to undo?
 ├── Yes → variant="danger"
 └── No
      ├── Is it the single most important action on the screen? → variant="primary"
      └── Default → variant="secondary"
````

- Put the safety question first in a decision tree. A tree that asks "most important?" first sends "Delete project" to `primary`.
- **Tokens**: the load-bearing rule is which layer is allowed. Components use semantic tokens (`--bg-surface`), never primitives (`--gray-100`) and never raw values. Add a decision tree per role ("which background", "which text color").
- **Language**: numbers and absolutes, no hedges. "Body text is 16px, captions 14px, never below 12px" instead of "use small text sparingly". Give every non-obvious rule its reason so it generalizes. Cut every line that wouldn't change what the reader does.
- **Verify by prompting.** Ask an agent to build a real screen with the existing components, read the drift, and patch the docs (not the output). Hardcoded color means the token rule isn't findable or strict; an invented variant means the set isn't closed; the wrong component means a "use X, not Y" line is missing.

## Checklist

- [ ] Structure expressed as JSX children or slot props, not config objects
- [ ] Multi-part components use compound parts with context, and parts throw outside their root
- [ ] Variants as a closed string union, plus size and a `className` escape hatch; no boolean soup or style-prop explosion
- [ ] Prop names mirror HTML and follow one `value` / `defaultValue` / `onValueChange` pattern
- [ ] Stateful components work controlled and uncontrolled
- [ ] Refs passed through, remaining props spread, consumer handlers composed, `type="button"` default
- [ ] `asChild` (or the project's `render` convention) for element swapping; links render `<a>`
- [ ] State exposed as `data-state` / `data-disabled` plus matching ARIA
- [ ] Focus, keyboard, and positioning behavior built on the project's headless primitive
- [ ] No premature abstraction, duplicate helpers, or `V2` components
- [ ] Design system docs trace every name to code, close the variant set, and name the default
