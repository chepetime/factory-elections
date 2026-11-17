// Compatibility entry point; `factory serve` now owns the complete local backend.
export async function serveHealth(root: string, port: number): Promise<void> {
  const { serveBackend } = await import('@factory/backend/lifecycle');
  await serveBackend(root, { healthPort: port });
}
