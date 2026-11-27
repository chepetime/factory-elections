'use client';

import type { ReactNode } from 'react';
import { Folder, Paperclip, Plus } from 'lucide-react';
import { Button } from '@factory/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@factory/ui/components/dropdown-menu';
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
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
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
      </DropdownMenuTrigger>
      <ComposerMenu label="Add" align="start">
        {onAttach && (
          <DropdownMenuItem className={composerMenuRow} onClick={onAttach}>
            <Paperclip aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span>Files and folders</span>
          </DropdownMenuItem>
        )}
        {actions.map((action) => (
          <DropdownMenuItem
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
          </DropdownMenuItem>
        ))}
        {folderItems && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={composerMenuRow}>
              <Folder aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">Work in a folder</span>
            </DropdownMenuSubTrigger>
            <ComposerMenu label="Work in a folder" align="start" side="right">
              {folderItems}
            </ComposerMenu>
          </DropdownMenuSub>
        )}
      </ComposerMenu>
    </DropdownMenu>
  );
}
