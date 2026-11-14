// Local-only guard: accept requests addressed to this machine, and state-changing requests only
// from this app's own pages. Protects against DNS rebinding and cross-site requests.
import { NextResponse, type NextRequest } from 'next/server';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function hostname(host: string | null): string | undefined {
  if (!host) return undefined;
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return undefined;
  }
}

export function isAllowed(method: string, host: string | null, origin: string | null): boolean {
  const name = hostname(host);
  if (!name || !LOCAL_HOSTS.has(name)) return false;
  if (method === 'GET' || method === 'HEAD') return true;
  if (!origin) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  if (!isAllowed(request.method, request.headers.get('host'), request.headers.get('origin'))) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  return NextResponse.next();
}
