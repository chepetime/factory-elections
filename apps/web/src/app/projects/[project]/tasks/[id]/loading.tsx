import { LatticeLoader } from '@factory/ui/components/lattice-loader';

/** Shown at once when a task opens, while its run, session and diff load. */
export default function LoadingTask() {
  return (
    <div className="p-6 text-muted-foreground">
      <LatticeLoader label="Loading the task…" showTimer={false} />
    </div>
  );
}
