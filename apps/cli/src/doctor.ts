// CLI formatting over the same environment checks used by the backend.
import { environmentChecks } from '@factory/compose/diagnostics';
export { pnpmCheck } from '@factory/compose/diagnostics';

export async function doctor(root: string): Promise<boolean> {
  const checks = await environmentChecks(root);
  for (const c of checks)
    process.stdout.write(
      `${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}: ${c.detail}${c.ok || !c.fix ? '' : `\n      fix: ${c.fix}`}\n`,
    );
  return checks.every((c) => c.ok);
}
