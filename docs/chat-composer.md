# Chat Composer

An original implementation of the interaction described by the [public affectUI Chat Composer reference](https://www.affectui.com/components/chat-composer). It uses shadcn Button/Textarea, Tailwind, Base UI menus, and Motion. Paid source is not included.

Try it under `/components#chat-composer` or **Factory → Chat Composer → Interactive** in Storybook. The support roadmap preserves all 26 items in the original requested list; 22 remain planned after this implementation.

## Integration

Import `ChatComposer` from `@/components/chat-composer`. The full typed contract lives alongside the component.

```tsx
<ChatComposer
  models={[{ id: 'configured-model', name: 'My model' }]}
  folders={['project']}
  onSend={async (message, context) => {
    await sendMessage(message, context);
  }}
/>
```

`context` contains the selected model ID, approval mode, folder (or null), connected app IDs, and attachment metadata. The caller owns authentication, file contents/upload, backend permissions, and message delivery. The selected approval mode is a UI preference, not a permission grant. There are no provider, app, or folder defaults in the reusable component. Supply their IDs, labels, icons, and callbacks as props. With no models supplied, the picker is omitted and the send context contains `model: null`. Sample brands and model labels live only in `components/demos/chat-composer-fixtures.tsx`.

- `value`/`onValueChange`, `model`/`onModelChange`, `folder`/`onFolderChange`, and `connectedApps`/`onAppsChange` support caller-managed state. Omit the corresponding value prop for local state. Use `folder={null}` to explicitly select no folder.
- `onSend` may return a promise. While it runs the draft is read-only and repeated submissions are blocked. Success clears the draft; rejection preserves it and exposes an alert. `sending`, `disabled`, and `error` support external state.
- `attachments` holds `{ id, name }` metadata. `onAttach` opens the caller's picker; `onRemoveAttachment` asks the caller to remove an item. The component does not read file contents.
- The approval menu offers `request` (Request approval), `auto` (Approve for me), and `full` (Full access). `approvalMode`/`onApprovalModeChange` support controlled state; otherwise the mode defaults to `request` and is managed locally. `onSend` receives the selected mode in its context. The caller enforces the actual policy. `approvalHelpUrl` optionally shows the Learn more link.
- Voice is an adapter: supply `recording`, `dictation`, `onStartDictation`, and `onStopDictation(commit)`. Finishing adds the current transcript to the draft; Escape discards it. The caller stops its speech service and clears the transcript when notified. The component never opens a microphone.

Enter sends; Shift+Enter adds a newline. IME composition does not submit. Menus use Base UI keyboard navigation and focus restoration. Controls have 44px touch targets, labels and status announcements, and the compact toolbar responds to its container width. Motion respects reduced-motion preferences.

## Demo and validation

`ChatComposerDemo` uses local state, a simulated transcript, and a local file-name picker. It displays the submitted message and context without calling a service. It does not replace the application's existing task composer.

Storybook covers empty, ready, sending, disabled, error, minimal, narrow, attachment, model/context selection, keyboard/IME, failed and duplicate sends, approval selection, keyboard navigation, focus restoration, dictation commit/cancel, controlled state, and reset. Both themes run interaction and axe checks. The menu-toggling story repeats opening and closing all four menus and checks that popup text never scales. Run it with `STORYBOOK_MOTION=normal` as documented in the workshop to check ordinary motion as well as reduced motion. Menus use a 100ms opacity-only entrance and immediate dismissal to avoid scale snapping or lingering exit layers. The support roadmap unit tests preserve the original list and verify implementation paths.
