// The look of the ticket header's sidebar toggle. It knows nothing about settings or routing, so
// Storybook can show both states; `TaskDetailsToggle` wires it to the saved setting.
import { PanelRight, PanelRightClose } from 'lucide-react';
import { cn } from '@factory/ui/lib/utils';

/** Cmd or Ctrl plus this key; the key sits next to the pane it toggles. */
export const DETAILS_PANE_KEY = '\\';

export function TaskDetailsToggleButton({
  expanded,
  pending = false,
  onToggle,
}: {
  expanded: boolean;
  pending?: boolean;
  onToggle: () => void;
}) {
  const label = expanded ? 'Hide task details' : 'Show task details';
  const Icon = expanded ? PanelRightClose : PanelRight;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={pending}
      aria-label={label}
      aria-expanded={expanded}
      aria-keyshortcuts={`Control+${DETAILS_PANE_KEY} Meta+${DETAILS_PANE_KEY}`}
      title={`${label} (⌘${DETAILS_PANE_KEY})`}
      className={cn(
        'ml-auto inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60',
        expanded && 'text-foreground',
      )}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
