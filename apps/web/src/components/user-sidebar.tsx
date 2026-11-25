'use client';
// The sidebar on /user pages: the same panel as the project sidebar, with the user settings views.
import {
  Bell,
  Bot,
  ListTodo,
  MessageSquare,
  ScrollText,
  SlidersHorizontal,
  UserRound,
  X,
} from 'lucide-react';
import { usePathname } from 'next/navigation';
import { SidebarLink } from '@/components/sidebar-link';
import { useUserPreferences } from '@/components/user-preferences';
import { cn } from '@/lib/utils';

export const USER_VIEWS = [
  { group: 'My account', href: '/user', label: 'Profile', icon: UserRound },
  { group: 'My account', href: '/user/preferences', label: 'Preferences', icon: SlidersHorizontal },
  { group: 'My account', href: '/user/tasks', label: 'Tasks', icon: ListTodo },
  { group: 'My account', href: '/user/chat', label: 'Chat', icon: MessageSquare },
  { group: 'My account', href: '/user/notifications', label: 'Notifications', icon: Bell },
  { group: 'Agents', href: '/user/providers', label: 'Providers and models', icon: Bot },
  { group: 'Agents', href: '/user/rules', label: 'Rules', icon: ScrollText },
] as const;

export function UserSidebar({ width, onClose }: { width: number; onClose: () => void }) {
  const pathname = usePathname();
  const { identity } = useUserPreferences();
  const name = identity.name || identity.github_username || 'You';
  const groups = [...new Set(USER_VIEWS.map((v) => v.group))];
  return (
    <aside
      aria-label="User settings"
      style={{ width }}
      className="relative m-2 flex flex-col rounded-xl bg-muted/70 max-[899px]:m-0 max-[899px]:rounded-none max-[899px]:!w-72"
    >
      <div className="flex items-center gap-2 p-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-xs font-semibold uppercase">
            {name[0]}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{name}</span>
            {identity.github_username && (
              <span className="block truncate text-xs text-muted-foreground">
                @{identity.github_username}
              </span>
            )}
          </span>
        </div>
        <button
          type="button"
          aria-label="Close sidebar"
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring min-[900px]:hidden"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </div>

      <nav aria-label="User settings views" className="flex flex-col px-2 pb-2">
        {groups.map((group, i) => (
          <div key={group} className={cn('flex flex-col gap-1', i > 0 && 'mt-4')}>
            <p className="px-3 pb-1 text-xs text-muted-foreground">{group}</p>
            {USER_VIEWS.filter((v) => v.group === group).map(({ href, label, icon: Icon }) => (
              <SidebarLink key={href} href={href} current={pathname === href}>
                <Icon aria-hidden="true" className="size-4 text-muted-foreground" /> {label}
              </SidebarLink>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
