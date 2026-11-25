const COLUMNS = ['Backlog', 'Todo', 'In progress', 'In review', 'Done', 'Blocked', 'Cancelled'];

export default function TasksLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy="true">
      <header className="px-6 pt-6 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <p className="mt-1 text-sm text-muted-foreground">Loading the board…</p>
      </header>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-hidden px-6 pt-7 pb-6">
        {COLUMNS.map((name) => (
          <div key={name} className="flex w-72 shrink-0 flex-col gap-2 rounded-2xl bg-muted/50 p-3">
            <p className="text-sm font-semibold text-muted-foreground">{name}</p>
            <div className="h-20 rounded-xl bg-muted motion-safe:animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
