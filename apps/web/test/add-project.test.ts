import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendCall } from '@factory/backend-client';
import { addProject } from '@/app/actions';
import { suggestName } from '@/components/add-project-form';

vi.mock('@factory/backend-client', () => ({ backendCall: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const cookieSet = vi.fn();
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ set: cookieSet })) }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
const rpc = vi.mocked(backendCall);
function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}
afterEach(() => vi.clearAllMocks());

describe('addProject', () => {
  it('registers through the backend, remembers the project and opens it', async () => {
    rpc.mockResolvedValue({ json: JSON.stringify({ name: 'demo', repo: '/code/demo' }) });
    await expect(addProject({}, form({ name: ' demo ', repo: ' /code/demo ' }))).rejects.toThrow(
      'redirect:/projects/demo/tasks/new',
    );
    expect(rpc).toHaveBeenCalledWith('AddProject', { name: 'demo', repo: '/code/demo' });
    expect(cookieSet).toHaveBeenCalledWith('factory.lastProject', 'demo', expect.any(Object));
  });
  it('rejects invalid input before calling the backend', async () => {
    expect((await addProject({}, form({ name: '../x', repo: '/code/x' }))).error).toMatch(/letters/);
    expect((await addProject({}, form({ name: 'x', repo: 'code/x' }))).error).toMatch(/absolute/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('shows backend errors and stays on the form', async () => {
    rpc.mockRejectedValue(Object.assign(new Error('x'), { details: 'project already exists: demo' }));
    expect(await addProject({}, form({ name: 'demo', repo: '/code/demo' }))).toEqual({
      error: 'project already exists: demo',
    });
    expect(cookieSet).not.toHaveBeenCalled();
  });
});

describe('suggestName', () => {
  it('derives a valid project name from the folder', () => {
    expect(suggestName('/Users/me/code/my-app/')).toBe('my-app');
    expect(suggestName('/code/My App (v2)')).toBe('My-App-v2');
    expect(suggestName('')).toBe('');
  });
});
