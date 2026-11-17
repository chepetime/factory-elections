# Forms

Inputs, labels, validation, submission, buttons, and form controls. Read this when building or reviewing any form, text input, search field, login or signup flow, settings page, checkout, or submit handler. Write the CSS in the project's existing styling system; the values matter, the syntax doesn't.

Sweep forms in order of what they cost when broken: auth and checkout first, then creation flows, then settings.

## Structure

### Every input lives in a `<form>`

Without a wrapping `<form>`, Enter does nothing, password managers can't find the fields, and the mobile keyboard's return key is dead.

```jsx
<form onSubmit={handleSubmit}>
  <label htmlFor="email">Email</label>
  <input id="email" name="email" type="email" autoComplete="email" />
  <button type="button" onClick={onCancel}>Cancel</button>
  <button type="submit">Continue</button>
</form>
```

- **Every `<button>` inside a form has an explicit `type`.** A bare `<button>` is a submit button, so "Cancel", a password reveal, or a menu trigger submits the form.
- **Handle submission in `onSubmit`, not a button's `onClick`**, so Enter and the button go through the same path.

### Textareas submit on Cmd/Ctrl+Enter

Enter inserts a newline in a textarea, so bind Cmd+Enter (Mac) and Ctrl+Enter (Windows). `requestSubmit()` runs validation and fires `submit` like a real submission; `submit()` skips both.

```jsx
<textarea
  onKeyDown={(e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }}
/>
```

For a chat composer where plain Enter sends, skip while an IME is composing (`e.isComposing || e.keyCode === 229`), or Japanese and Chinese users send mid-word. Details in [interaction-details.md](interaction-details.md).

## Labels

### Every input has an associated label

Clicking the label must focus the input. Without the association the label is decoration and screen readers announce the field as unlabeled.

```html
<label for="email">Email</label>
<input id="email" type="email" />

<!-- or wrap -->
<label>
  Email
  <input type="email" />
</label>
```

- **A placeholder is not a label.** It disappears the moment the user starts typing, right when they need the reminder. Use a persistent label above the field.
- **A search field with no room for a visible label still needs a name:** `aria-label="Search projects"`.
- **Placeholder text that carries information needs 4.5:1 contrast**, one more reason it can't stand in for the label.

### No dead zones on checkboxes, radios, and switches

The label, the control, and the gap between them must all be clickable. A 16px checkbox whose label doesn't toggle it is a target nobody can hit. Wrap everything in one label so the gap sits inside it:

```html
<label class="checkbox-row">
  <input type="checkbox" />
  <span>Remember me</span>
</label>
```

```css
.checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
```

Wrong: `<input type="checkbox"> <span>Remember me</span>` with a flex `gap` between the input and a separate `<label for>`. The gap is dead.

## Input types and keyboards

The right `type`, `inputmode`, and `autocomplete` get you the right mobile keyboard, browser validation, and one-tap autofill. On a phone that is the difference between a signup and a bounce.

```html
<input type="email"    autocomplete="email" />
<input type="tel"      autocomplete="tel" />
<input type="url" />
<input type="search"   enterkeyhint="search" />
<input type="password" autocomplete="current-password" />  <!-- login -->
<input type="password" autocomplete="new-password" />      <!-- signup, change password -->
<input type="text"     autocomplete="one-time-code" inputmode="numeric" />
<input type="text"     inputmode="decimal" />              <!-- amounts -->
<input type="text"     autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" />
```

- **`inputmode="numeric"` for codes, `"decimal"` for amounts.** Prefer these over `type="number"` for anything that isn't a true quantity: `type="number"` strips leading zeros, accepts `e`, and changes value on scroll.
- **`enterkeyhint="search"` / `"send"` / `"done"` / `"next"`** so the return key says what it does.
- **`autocapitalize="none"` and `autocorrect="off"`** on usernames, emails, codes, and URLs.
- **Address and payment fields** keep autofill on with their tokens: `name`, `given-name`, `street-address`, `postal-code`, `country`, `cc-number`, `cc-exp`, `cc-csc`.

### Turning autofill noise off

Disable `spellcheck` and `autocomplete` only where autofill genuinely doesn't apply: search boxes, slugs, API keys, free-form labels. Disable password-manager overlays on fields where they don't belong (a search box, a project name):

```html
<input type="text" spellcheck="false" autocomplete="off" />
<input data-1p-ignore data-lpignore="true" />
```

Never set `autocomplete="off"` on username, email, password, one-time-code, name, address, or payment fields. Give them the right token instead.

## iOS zoom: 16px inputs

iOS Safari zooms the page when a focused input's text is under 16px. Set it on every input, textarea, and select, including a contenteditable editor:

```css
input, textarea, select { font-size: 16px; }
```

If desktop needs smaller inputs, make the small size the default and restore 16px wherever the pointer is coarse:

```css
input, textarea, select { font-size: 14px; }
@media (pointer: coarse) {
  input, textarea, select { font-size: 16px; }
}
```

Tailwind v4.1+: `text-base pointer-fine:text-sm` on the shared input. Never gate it on a width breakpoint (`md:text-sm`): an iPad is wide and still zooms. Never fix it with `maximum-scale=1`; that blocks pinch zoom for everyone.

## Input decorations

Prefix and suffix icons sit on top of the input, absolutely positioned with padding making room. Rendered as siblings inside a wrapper styled to look like the input, they lie about the hit area: clicking the icon does nothing.

```css
.input-wrapper { position: relative; }
.input-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
}
.input-field { padding-left: 40px; }
```

Clickable decorations (a clear button, a password reveal) do their job and keep focus in the input. `preventDefault()` on `mousedown` stops the button from stealing focus, so the caret stays and the phone keyboard stays open:

```jsx
<button
  type="button"
  aria-label="Clear search"
  onMouseDown={(e) => e.preventDefault()}
  onClick={() => {
    setQuery("");
    inputRef.current?.focus();
  }}
>
  <XIcon aria-hidden />
</button>
```

A stepper can leave the tab order because the arrow keys in the input do the same thing. A clear button or a password reveal has no equivalent key, so it stays focusable.

## Password fields

- **Login uses `autocomplete="current-password"`; signup and change-password use `"new-password"`.** The right token is what makes password managers offer to fill or generate.
- **Keep a username field on the page** (visible, or hidden with `autocomplete="username"`) so managers save the credential against the right account.
- **Offer a show/hide toggle** as a `type="button"` with `aria-label="Show password"` / `"Hide password"` and `aria-pressed`. It toggles `type` between `password` and `text` and keeps focus in the input.
- **State the rules before they type** ("At least 8 characters"), next to the field, not only in the error.
- **Never block paste** into password or confirm fields. It breaks password managers.

## One-time codes

- **Prefer a single input:** `autocomplete="one-time-code" inputmode="numeric" maxlength="6"`. iOS and Android offer the SMS code above the keyboard, and paste works with no extra code.
- **If the design needs separate boxes**, keep one real input underneath (or handle paste across all boxes), move back on Backspace in an empty box, and let the user click any box to correct a digit.
- **Don't auto-advance between unrelated fields**, and don't auto-submit if correcting a digit would be hard. Auto-advance feels clever until someone needs to fix a mistake. Auto-submitting a complete code is fine when the box stays editable after a failure.

## Validation

### Reward early, punish late

Don't flag a field while the user is still typing their first attempt; "invalid email" after one character is yelling. Validate on blur or on submit. Once a field has shown an error, switch that field to validating on change so the error clears the moment it's fixed.

react-hook-form: `mode: "onTouched"` (or `"onBlur"`) with `reValidateMode: "onChange"`. Not `mode: "onChange"`.

### Errors sit next to their field and name the fix

An error summary at the top makes the user hunt. Each message renders directly under its field, wired with `aria-describedby`, and the field gets `aria-invalid`. Color alone is invisible to colorblind users and silent to screen readers: use color, an icon, and text.

```jsx
<div className="field">
  <label htmlFor="email">Email</label>
  <input
    id="email"
    aria-invalid={!!error}
    aria-describedby={error ? "email-error" : undefined}
  />
  {error && (
    <p id="email-error" className="error">
      <AlertIcon aria-hidden /> {error}
    </p>
  )}
</div>
```

| Instead of | Write |
| --- | --- |
| "Invalid input" | "Your email must include an @" |
| "Required" | "Enter your company name" |
| "Password error" | "Use at least 8 characters" |

- **Reserve the error line's space** or animate its height, so an error appearing doesn't shove the form around.
- **The field's states are distinct:** default, hover, focus, error, and disabled each look different, so users can tell active from broken.
- **Server-side field errors** ("That email is already registered") render on their field like client errors.

### After a failed submit

- **Move focus to the first invalid field** so keyboard and screen reader users land on the problem.
- **Keep every value the user typed.** Never `reset()` before the response is checked.
- **Say what happened and what to do**, next to the form: "We couldn't save your changes. Check your connection and try again." A `catch` that only `console.error`s is a silent failure. `fetch` doesn't throw on a 500: check `response.ok`.

## Submit buttons

### No double submit

A submit button that stays enabled sends the request twice on a double-click or an impatient second tap: two charges, two invites, two projects. Disable at once, guard the handler, say what's happening, and reset in `finally` so a failed request doesn't leave the form stuck:

```jsx
const [isSubmitting, setIsSubmitting] = useState(false);

async function handleSubmit(e) {
  e.preventDefault();
  if (isSubmitting) return;
  const data = new FormData(e.currentTarget);
  setIsSubmitting(true);
  try {
    const res = await submitForm(data);
    if (!res.ok) setFormError("We couldn't save your changes. Try again.");
  } catch {
    setFormError("We couldn't reach the server. Check your connection and try again.");
  } finally {
    setIsSubmitting(false);
  }
}

<button type="submit" disabled={isSubmitting}>
  {isSubmitting ? "Saving…" : "Save changes"}
</button>
```

- **The label names the action** ("Save changes", "Create project", "Send invite"), not "Submit". The loading label continues it ("Saving…").
- **Keep the button's width stable** while the label or spinner changes, or the layout twitches on every submit. Set a `min-width`, or overlay the spinner and hide the label with `visibility: hidden`.
- **The spinner waits ~150ms and stays at least ~300ms**; the disable happens immediately. See [interaction-details.md](interaction-details.md).
- **React 19 / Next.js:** `useFormStatus().pending` or `useActionState`'s pending flag does the same job.

### Disabled buttons

- **Prefer an enabled submit that validates and shows errors** over a disabled one with no explanation. A disabled button can't be focused, so it never says what's missing.
- **When a button is disabled for a reason, say the reason** next to it, not only in a tooltip (touch users never see it, and disabled elements don't fire hover in every browser).
- **Disabled styling uses a specific muted token**, not `opacity`, which passes contrast on one background and fails on another.

### Buttons are buttons

Actions are `<button>`, navigation is `<a href>`. A `<div onClick>` isn't focusable, doesn't fire on Enter or Space, and isn't announced as interactive. `role="button"` on a div is almost always a sign it should have been a button.

```jsx
// Wrong
<div onClick={save}>Save</div>
// Right
<button type="button" onClick={save}>Save</button>
```

Press feedback is `scale(0.97)` on `:active` with a 150ms ease-out transition ([animation-css.md](animation-css.md)). If the action has a keyboard shortcut, show it in the button's tooltip.

## Selects, checkboxes, radios, switches

- **Native `<select>` is right on mobile.** It opens the platform picker. A custom select (Radix, Base UI) earns its place when the options need rich content or search; it must keep keyboard support, typeahead, and opening on the current value ([interaction-details.md](interaction-details.md)).
- **Radio groups for 2–5 mutually exclusive options visible at once; a select for more.** Wrap a group in `<fieldset>` with a `<legend>` so the question is announced.
- **A switch means immediate effect.** Use it for settings that apply without a save button. Inside a form that saves on submit, use a checkbox.
- **Switches announce state:** `role="switch"` with `aria-checked`, or a primitive that does it. The label says what it controls, not "On/Off".
- **Sliders update the value live during drag.** Update-on-release feels disconnected and makes exact values hard to hit. Show the current value.
- **Steppers and number fields:** hold-to-repeat, Shift for steps of 10, and the wheel only while focused; see [interaction-details.md](interaction-details.md).

## Focus and autofocus

- **Visible focus on every control.** Style `:focus-visible`, never bare `outline: none`. Details in [touch-accessibility.md](touch-accessibility.md).

```css
input:focus-visible { outline: 2px solid var(--gray-12); outline-offset: 2px; }
```

- **Autofocus the first input when a modal opens**, on fine pointers only. On touch, autofocus pops the keyboard and shoves the layout up. Read the media query in an effect so server and client renders agree:

```jsx
useEffect(() => {
  if (window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus();
}, []);
```

- **After a successful submit, move focus somewhere meaningful:** the new item, the success message (with `role="status"`), or the next step's heading. Focus left on a removed or disabled button falls back to `<body>`.
- **Announce async results.** A "Saved" message or a form-level error appears inside a live region that already exists in the DOM: `role="status"` for confirmations, `role="alert"` for errors needing attention.

## Destructive actions

- **Confirm before anything irreversible** (delete, remove, revoke, cancel subscription, leave team), or offer an undo window after it. Use a proper dialog; `window.confirm()` is a floor, not a product.
- **The confirm button names the outcome** ("Delete project"), not "OK" or "Yes", and is styled as destructive, not as the primary next to it.
- **For high-stakes deletes, have them type the name** of the thing being deleted.
- When the project has no dialog primitive, don't build a focus trap from scratch to add a confirmation; flag it.

## Prefill and preserve

- **Prefill everything you know:** the logged-in user's name and email on a support form, the current values on an edit form, the email an invite link carries on the signup it leads to.
- **Prefill from link context.** A "Change username" link lands on a form prefilled with "I'd like to change my username to:".
- **Unsaved work survives an accident.** Long forms, editors, and multi-step flows warn on `beforeunload` while dirty, or persist the draft to `sessionStorage`.
- **Debounce search-as-you-type at ~300ms.**

## Primitives

Build on accessible primitives: Base UI first; Radix or React Aria if they fit the codebase better. Focus management, ARIA, and keyboard support are non-negotiable whichever one is used.

## Walk it by hand

Attributes can be proven from code; the flow can't. For each critical form, list as device checks: complete it using only the keyboard; submit offline and confirm the error shows and values are kept; double-click submit and confirm one request in the network tab; fill it with browser autofill and a password manager; open it on an iPhone and confirm no field zooms.

## Checklist

- [ ] Inputs wrapped in `<form onSubmit>`; Enter submits; Cmd/Ctrl+Enter submits textareas via `requestSubmit()`
- [ ] Every `<button>` in a form has an explicit `type`
- [ ] Every input has an associated label; placeholders are never the label; checkbox rows have no dead zones
- [ ] Correct `type`, `inputmode`, `autocomplete`, and `enterkeyhint`; autofill never turned off on identity, password, code, address, or payment fields
- [ ] Inputs are 16px wherever the pointer is coarse
- [ ] Decorations overlay the input; clickable ones keep focus in it
- [ ] Validation on blur/submit, then on change once an error shows; errors under the field with icon, text, `aria-invalid`, and `aria-describedby`
- [ ] Failed submits keep values, re-enable the button, explain the fix, and focus the first invalid field
- [ ] Submit disables at once, guards the handler, shows a stable-width loading label, and resets in `finally`
- [ ] Autofocus in modals on fine pointers only; focus moves somewhere meaningful after submit
- [ ] Destructive actions confirm with a button that names the outcome
- [ ] Forms prefilled from user data and link context
