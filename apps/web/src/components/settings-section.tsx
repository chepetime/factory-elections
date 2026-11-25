import type { ReactNode } from 'react';

/** One settings card: the same frame, heading scale and spacing on every settings page. */
export function SettingsSection({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="rounded-2xl border bg-card p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-72">
          <h2 id={id} className="text-base font-semibold">
            {title}
          </h2>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children && <div className="mt-5 flex flex-col gap-4">{children}</div>}
    </section>
  );
}
