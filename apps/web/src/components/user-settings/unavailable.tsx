/** The view when the backend cannot read the user settings. */
export function SettingsUnavailable({ title, error }: { title: string; error: string }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-destructive">User settings unavailable: {error}</p>
    </div>
  );
}
