import type { Metadata } from 'next';
import { SystemNetwork } from '@/components/system-network';
import { readNetwork } from '@/lib/network';

export const metadata: Metadata = { title: 'Network' };
export const dynamic = 'force-dynamic';

/** A live map of this installation: what talks to what, and how busy each part is. */
export default async function NetworkPage() {
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Network</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The parts of this installation and the links between them, live. Select a part for its details.
        </p>
      </header>
      <SystemNetwork initial={await readNetwork()} />
    </div>
  );
}
