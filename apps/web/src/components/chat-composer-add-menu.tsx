'use client';

import type { ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import { ChevronRight, Folder, Paperclip, Plus } from 'lucide-react';
import { Button } from '@factory/ui/components/button';
import { ComposerMenu, composerMenuRow } from '@/components/composer-menu';

export type ChatAddAction = {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
};

export function ChatComposerAddMenu({
  actions,
  onAttach,
  folderItems,
  disabled,
}: {
  actions: ChatAddAction[];
  onAttach?: () => void;
  folderItems?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 text-muted-foreground"
          />
        }
        aria-label="Add"
        disabled={disabled || (!onAttach && !folderItems && actions.length === 0)}
      >
        <Plus aria-hidden="true" />
      </Menu.Trigger>
      <ComposerMenu label="Add" align="start">
        {onAttach && (
          <Menu.Item className={composerMenuRow} onClick={onAttach}>
            <Paperclip aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span>Files and folders</span>
          </Menu.Item>
        )}
        {actions.map((action) => (
          <Menu.Item
            key={action.id}
            className={composerMenuRow}
            disabled={action.disabled}
            onClick={action.onSelect}
          >
            {action.icon && (
              <span
                aria-hidden="true"
                className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-full"
              >
                {action.icon}
              </span>
            )}
            <span className="min-w-0 flex-1 break-words">
              <span className="block">{action.label}</span>
              {action.description && (
                <span className="block text-xs text-muted-foreground">{action.description}</span>
              )}
            </span>
          </Menu.Item>
        ))}
        {folderItems && (
          <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger className={composerMenuRow}>
              <Folder aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">Work in a folder</span>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            </Menu.SubmenuTrigger>
            <ComposerMenu label="Work in a folder" align="start" side="right">
              {folderItems}
            </ComposerMenu>
          </Menu.SubmenuRoot>
        )}
      </ComposerMenu>
    </Menu.Root>
  );
}
