'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from 'motion/react';
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Folder,
  Hand,
  LoaderCircle,
  Mic,
  Paperclip,
  Plus,
  Square,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export type ChatModel = {
  id: string;
  name: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
};
export type ChatApp = { id: string; name: string; logo?: ReactNode };
export type ChatAttachment = { id: string; name: string };
export type ChatMessageDetails = {
  model: string;
  folder: string | null;
  connectedApps: string[];
  attachments: ChatAttachment[];
};

export type ChatComposerProps = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  models?: ChatModel[];
  model?: string;
  onModelChange?: (model: ChatModel) => void;
  folders?: string[];
  folder?: string | null;
  onFolderChange?: (folder: string | null) => void;
  apps?: ChatApp[];
  connectedApps?: string[];
  onAppsChange?: (connected: string[]) => void;
  attachments?: ChatAttachment[];
  onAttach?: () => void;
  onRemoveAttachment?: (attachment: ChatAttachment) => void;
  onSend?: (message: string, details: ChatMessageDetails) => void | Promise<void>;
  /** Requesting approval does not grant permission. The caller owns that workflow. */
  onRequestApproval?: () => void | Promise<void>;
  approvalStatus?: 'idle' | 'pending' | 'requested';
  /** Speech integration belongs to the caller; this component never opens a microphone. */
  recording?: boolean;
  dictation?: string;
  onStartDictation?: () => void;
  onStopDictation?: (commit: boolean) => void;
  sending?: boolean;
  disabled?: boolean;
  error?: string;
  className?: string;
};

const DEFAULT_MODELS: ChatModel[] = [
  { id: 'auto', name: 'Auto', description: 'Let the assistant choose' },
  { id: 'claude', name: 'Claude', description: 'Use your configured Anthropic model' },
  { id: 'chatgpt', name: 'ChatGPT', description: 'Use your configured OpenAI model' },
];

export function ChatComposer({
  value,
  defaultValue = '',
  onValueChange,
  placeholder = 'Start by typing…',
  models = DEFAULT_MODELS,
  model,
  onModelChange,
  folders = [],
  folder,
  onFolderChange,
  apps = [],
  connectedApps,
  onAppsChange,
  attachments = [],
  onAttach,
  onRemoveAttachment,
  onSend,
  onRequestApproval,
  approvalStatus,
  recording = false,
  dictation = '',
  onStartDictation,
  onStopDictation,
  sending = false,
  disabled = false,
  error,
  className,
}: ChatComposerProps) {
  const [draft, setDraft] = useState(defaultValue);
  const [ownModel, setOwnModel] = useState(models.find((entry) => !entry.disabled)?.id);
  const [ownFolder, setOwnFolder] = useState<string | null>(null);
  const [ownApps, setOwnApps] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [approval, setApproval] = useState<'idle' | 'pending' | 'requested'>('idle');
  const [failure, setFailure] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const sendLock = useRef(false);
  const approvalLock = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const reduceMotion = useReducedMotion();
  const text = value ?? draft;
  const chosenModel =
    models.find((entry) => entry.id === (model ?? ownModel) && !entry.disabled) ??
    models.find((entry) => !entry.disabled);
  const chosenFolder = folder !== undefined ? folder : ownFolder;
  const appIds = connectedApps ?? ownApps;
  const connected = apps.filter((app) => appIds.includes(app.id)).map((app) => app.id);
  const approvalState = approvalStatus ?? approval;
  const busy = sending || pending;
  const locked = disabled || busy;
  const messageError = error || failure;
  const canSend = Boolean(onSend && text.trim()) && !locked && !recording;

  function changeText(next: string) {
    if (value === undefined) setDraft(next);
    onValueChange?.(next);
    setFailure(null);
  }

  async function send() {
    if (!canSend || !onSend || sendLock.current) return;
    sendLock.current = true;
    setPending(true);
    setFailure(null);
    try {
      await onSend(text.trim(), {
        model: chosenModel?.id ?? 'auto',
        folder: chosenFolder,
        connectedApps: [...connected],
        attachments: [...attachments],
      });
      changeText('');
      setAnnouncement('Message sent.');
      field.current?.focus();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Message could not be sent. Your draft is saved.');
    } finally {
      sendLock.current = false;
      setPending(false);
    }
  }

  async function requestApproval() {
    if (!onRequestApproval || locked || approvalState !== 'idle' || approvalLock.current) return;
    approvalLock.current = true;
    setApproval('pending');
    setFailure(null);
    setAnnouncement('Requesting approval.');
    try {
      await onRequestApproval();
      setApproval('requested');
      setAnnouncement('Approval requested. Permission has not been granted by this component.');
    } catch (cause) {
      setApproval('idle');
      setFailure(cause instanceof Error ? cause.message : 'Approval request failed. Try again.');
    } finally {
      approvalLock.current = false;
    }
  }

  function stopDictation(commit: boolean) {
    if (!onStopDictation) return;
    if (commit && dictation.trim()) changeText([text.trimEnd(), dictation.trim()].filter(Boolean).join(' '));
    onStopDictation(commit);
    setAnnouncement(commit ? 'Dictation added to the draft.' : 'Dictation discarded.');
    field.current?.focus();
  }

  return (
    <LazyMotion features={domAnimation} strict>
      <form
        aria-label="Chat composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className={cn('mx-auto w-full max-w-[680px] rounded-2xl border bg-muted/50 shadow-xs', className)}
      >
        <div className="rounded-2xl border-b bg-card p-3 shadow-xs sm:p-4">
          <label htmlFor={`${id}-message`} className="sr-only">
            Message
          </label>
          <Textarea
            ref={field}
            id={`${id}-message`}
            value={recording ? [text, dictation].filter(Boolean).join(' ') : text}
            onChange={(event) => changeText(event.target.value)}
            readOnly={recording || busy}
            disabled={disabled}
            placeholder={recording ? 'Listening…' : placeholder}
            rows={3}
            aria-describedby={`${id}-hint${messageError ? ` ${id}-error` : ''}`}
            aria-invalid={Boolean(messageError)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && recording) {
                event.preventDefault();
                stopDictation(false);
              }
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.keyCode !== 229
              ) {
                event.preventDefault();
                void send();
              }
            }}
            className={cn(
              'min-h-24 w-full resize-none rounded-none border-0 bg-transparent px-1 py-1 text-base leading-6 shadow-none focus-visible:border-transparent focus-visible:ring-0 md:text-base dark:bg-transparent',
              recording && 'text-muted-foreground',
            )}
          />
          <p id={`${id}-hint`} className="sr-only">
            Enter sends. Shift plus Enter adds a new line. Escape discards active dictation.
          </p>
          {attachments.length > 0 && (
            <ul aria-label="Attachments" className="mb-3 flex max-h-28 flex-wrap gap-2 overflow-y-auto">
              <AnimatePresence initial={false}>
                {attachments.map((attachment) => (
                  <m.li
                    key={attachment.id}
                    layout={!reduceMotion}
                    initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduceMotion ? 0 : 0.15 }}
                    className="flex min-w-0 max-w-full items-center gap-2 rounded-lg border bg-muted/50 pl-3"
                  >
                    <Paperclip aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="max-w-48 truncate text-xs" title={attachment.name}>
                      {attachment.name}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 shrink-0"
                      aria-label={`Remove attachment ${attachment.name}`}
                      disabled={locked || !onRemoveAttachment}
                      onClick={() => onRemoveAttachment?.(attachment)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </m.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 shrink-0 text-muted-foreground"
              aria-label="Attach files"
              disabled={locked || recording || !onAttach}
              onClick={onAttach}
            >
              <Plus />
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 gap-2 px-2 text-muted-foreground"
              aria-label={
                approvalState === 'requested'
                  ? 'Approval requested'
                  : approvalState === 'pending'
                    ? 'Requesting approval'
                    : 'Request approval'
              }
              aria-busy={approvalState === 'pending'}
              disabled={locked || !onRequestApproval || approvalState !== 'idle'}
              onClick={() => void requestApproval()}
            >
              <AnimatePresence mode="wait" initial={false}>
                <m.span
                  aria-hidden="true"
                  key={approvalState}
                  initial={{ opacity: reduceMotion ? 1 : 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.1 }}
                >
                  {approvalState === 'pending' ? (
                    <LoaderCircle className="size-4 motion-safe:animate-spin" />
                  ) : approvalState === 'requested' ? (
                    <Check className="size-4" />
                  ) : (
                    <Hand className="size-4" />
                  )}
                </m.span>
              </AnimatePresence>
              <span className="hidden text-xs min-[480px]:inline">
                {approvalState === 'requested'
                  ? 'Approval requested'
                  : approvalState === 'pending'
                    ? 'Requesting…'
                    : 'Request approval'}
              </span>
            </Button>
            <div className="ml-auto flex min-w-0 items-center gap-1">
              {models.length > 0 && (
                <Menu.Root modal={false}>
                  <Menu.Trigger
                    render={<Button variant="ghost" type="button" className="min-h-11 min-w-0 gap-1 px-2" />}
                    aria-label={`Model: ${chosenModel?.name ?? 'Unavailable'}`}
                    disabled={locked || !chosenModel}
                  >
                    <span className="max-w-20 truncate text-sm">{chosenModel?.name ?? 'No model'}</span>
                    <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" />
                  </Menu.Trigger>
                  <ComposerMenu label="Choose a model" align="end">
                    <Menu.RadioGroup
                      value={chosenModel?.id}
                      onValueChange={(next: string) => {
                        const picked = models.find((entry) => entry.id === next);
                        if (!picked) return;
                        if (model === undefined) setOwnModel(picked.id);
                        onModelChange?.(picked);
                        setAnnouncement(`Using ${picked.name}.`);
                      }}
                    >
                      {models.map((entry) => (
                        <Menu.RadioItem
                          key={entry.id}
                          value={entry.id}
                          disabled={entry.disabled}
                          className={menuRow}
                        >
                          <span aria-hidden="true" className="shrink-0 text-muted-foreground [&>svg]:size-4">
                            {entry.icon ?? <Bot className="size-4" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm">{entry.name}</span>
                            {entry.description && (
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                {entry.description}
                              </span>
                            )}
                          </span>
                          <Menu.RadioItemIndicator>
                            <Check aria-hidden="true" className="size-4" />
                          </Menu.RadioItemIndicator>
                        </Menu.RadioItem>
                      ))}
                    </Menu.RadioGroup>
                  </ComposerMenu>
                </Menu.Root>
              )}
              <Button
                type="button"
                variant={recording ? 'secondary' : 'ghost'}
                size="icon"
                className="size-11 shrink-0 text-muted-foreground"
                aria-label={recording ? 'Finish dictation' : 'Start dictation'}
                aria-pressed={recording}
                title={!onStartDictation ? 'Voice input is not configured' : undefined}
                disabled={locked || (recording ? !onStopDictation : !onStartDictation)}
                onClick={() => (recording ? stopDictation(true) : onStartDictation?.())}
              >
                {recording ? <Square className="size-3.5" /> : <Mic />}
              </Button>
              <Button
                type="submit"
                size="icon"
                className="size-11 shrink-0 rounded-xl"
                aria-label={busy ? 'Sending message' : 'Send message'}
                aria-busy={busy}
                disabled={!canSend}
              >
                {busy ? <LoaderCircle className="motion-safe:animate-spin" /> : <ArrowUp />}
              </Button>
            </div>
          </div>
          {messageError && (
            <p id={`${id}-error`} role="alert" className="mt-3 px-1 text-xs leading-relaxed text-destructive">
              {messageError}
            </p>
          )}
        </div>
        {(folders.length > 0 || apps.length > 0) && (
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-1 px-2 py-1">
            {folders.length > 0 && (
              <Menu.Root modal={false}>
                <Menu.Trigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-11 min-w-0 max-w-full flex-1 justify-start gap-2 px-2 text-muted-foreground sm:max-w-[55%]"
                    />
                  }
                  disabled={locked}
                  title={chosenFolder ?? undefined}
                >
                  <Folder aria-hidden="true" className="size-4 shrink-0 text-blue-500" />
                  <span className="truncate text-xs">{chosenFolder ?? 'Work in a folder'}</span>
                  <ChevronDown aria-hidden="true" className="size-3 shrink-0" />
                </Menu.Trigger>
                <ComposerMenu label="Choose a folder" align="start">
                  <Menu.Item
                    className={menuRow}
                    onClick={() => {
                      if (folder === undefined) setOwnFolder(null);
                      onFolderChange?.(null);
                      setAnnouncement('No folder selected.');
                    }}
                  >
                    <span className="flex-1">No folder</span>
                    {!chosenFolder && <Check aria-hidden="true" className="size-4" />}
                  </Menu.Item>
                  {folders.map((path) => (
                    <Menu.Item
                      key={path}
                      className={menuRow}
                      onClick={() => {
                        const next = path === chosenFolder ? null : path;
                        if (folder === undefined) setOwnFolder(next);
                        onFolderChange?.(next);
                        setAnnouncement(next ? `Working in ${next}.` : 'No folder selected.');
                      }}
                    >
                      <Folder aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate" title={path}>
                        {path}
                      </span>
                      {chosenFolder === path && <Check aria-hidden="true" className="size-4" />}
                    </Menu.Item>
                  ))}
                </ComposerMenu>
              </Menu.Root>
            )}
            {apps.length > 0 && (
              <Menu.Root modal={false}>
                <Menu.Trigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      className="ml-auto min-h-11 min-w-0 gap-2 px-2 text-muted-foreground"
                    />
                  }
                  disabled={locked}
                  aria-label={`Connect apps, ${connected.length} selected`}
                >
                  <span className="text-xs">Connect apps</span>
                  <span aria-hidden="true" className="flex items-center gap-1">
                    {apps.slice(0, 3).map((app) => (
                      <span
                        key={app.id}
                        className={cn(
                          'flex size-5 items-center justify-center rounded-sm [&>svg]:size-4',
                          connected.includes(app.id) ? 'text-foreground' : 'text-muted-foreground',
                        )}
                      >
                        {app.logo ?? <Bot className="size-4" />}
                      </span>
                    ))}
                  </span>
                </Menu.Trigger>
                <ComposerMenu label="Choose connected apps" align="end">
                  {apps.map((app) => (
                    <Menu.CheckboxItem
                      key={app.id}
                      checked={connected.includes(app.id)}
                      onCheckedChange={(checked) => {
                        const next = checked
                          ? [...connected, app.id]
                          : connected.filter((entry) => entry !== app.id);
                        if (connectedApps === undefined) setOwnApps(next);
                        onAppsChange?.(next);
                        setAnnouncement(`${app.name} ${checked ? 'selected' : 'removed'}.`);
                      }}
                      className={menuRow}
                    >
                      <span aria-hidden="true" className="shrink-0 [&>svg]:size-4">
                        {app.logo ?? <Bot className="size-4" />}
                      </span>
                      <span className="flex-1">{app.name}</span>
                      <Menu.CheckboxItemIndicator>
                        <Check aria-hidden="true" className="size-4" />
                      </Menu.CheckboxItemIndicator>
                    </Menu.CheckboxItem>
                  ))}
                </ComposerMenu>
              </Menu.Root>
            )}
          </div>
        )}
        <p role="status" className="sr-only">
          {recording ? 'Dictation active. Finish to add it, or press Escape to discard.' : announcement}
        </p>
      </form>
    </LazyMotion>
  );
}

const menuRow =
  'flex min-h-11 cursor-default items-center gap-3 rounded-md px-3 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50';

function ComposerMenu({
  label,
  align,
  children,
}: {
  label: string;
  align: 'start' | 'end';
  children: ReactNode;
}) {
  return (
    <Menu.Portal>
      <Menu.Positioner align={align} sideOffset={8} className="z-50 outline-none">
        <Menu.Popup
          aria-label={label}
          className="max-h-[min(24rem,var(--available-height))] w-72 max-w-[calc(100vw-2rem)] origin-[var(--transform-origin)] overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg outline-none motion-safe:transition-[opacity,transform] motion-safe:duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
        >
          <div className="px-3 py-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
            {label}
          </div>
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}
