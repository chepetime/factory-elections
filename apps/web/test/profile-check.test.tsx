import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendCall } from '@factory/backend/client';
import { checkProjectSetup } from '@/app/actions';
import { ProfileCheckView } from '@/components/profile-check';

vi.mock('@factory/backend/client', () => ({ backendCall: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), useRouter: () => ({ refresh: vi.fn() }) }));
const rpc = vi.mocked(backendCall);
afterEach(() => vi.clearAllMocks());

describe('Check setup', () => {
  it('starts a check through the backend', async () => {
    rpc.mockResolvedValue({ json: JSON.stringify({ running: true, steps: [] }) });
    const form = new FormData();
    form.set('project', 'demo');
    expect(await checkProjectSetup({}, form)).toEqual({ message: 'Checking the setup…' });
    expect(rpc).toHaveBeenCalledWith('StartProfileCheck', { project: 'demo', id: '' });
  });

  it('shows each step, the failure output and the machine fault in plain words', () => {
    const page = renderToStaticMarkup(
      <ProfileCheckView
        project="demo"
        state={{
          running: false,
          passed: false,
          finished_at: '2026-11-18T20:00:00.000Z',
          steps: [
            {
              name: 'Preflight: AWS SSO',
              command: 'aws sts',
              outcome: 'passed',
              duration_ms: 1200,
              output: '',
            },
            {
              name: 'Setup',
              command: 'pnpm install',
              outcome: 'failed',
              duration_ms: 61_000,
              output: 'ERR_PNPM 401 Unauthorized',
              environment: 'a credential has expired or is missing',
            },
            { name: 'Test', command: 'pnpm test', outcome: 'skipped', duration_ms: 0, output: '' },
          ],
        }}
      />,
    );
    expect(page).toMatch(/Preflight: AWS SSO[\s\S]*Passed[\s\S]*1s/);
    expect(page).toMatch(/Setup[\s\S]*Failed[\s\S]*1m/);
    expect(page).toContain('Machine fault: a credential has expired or is missing');
    expect(page).toMatch(/data-tone="danger"[\s\S]*401 Unauthorized/);
    expect(page).toMatch(/Test[\s\S]*Skipped/);
    expect(page).toContain('Check setup');
  });

  it('shows live output while the check runs', () => {
    const page = renderToStaticMarkup(
      <ProfileCheckView
        project="demo"
        state={{ running: true, steps: [], log: '$ pnpm install\nProgress: 10' }}
      />,
    );
    expect(page).toMatch(/aria-label="Live output"[\s\S]*Progress: 10/);
    expect(page).toContain('Checking');
  });
});
