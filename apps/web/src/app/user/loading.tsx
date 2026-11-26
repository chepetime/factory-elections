import { LatticeLoader } from '@/components/bits/lattice-loader';

/** Profile and providers check the CLIs on this machine, which takes a few seconds. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl text-muted-foreground">
      <LatticeLoader label="Loading your settings" showTimer={false} />
    </div>
  );
}
