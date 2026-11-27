import { LatticeLoader } from '@factory/ui/components/lattice-loader';

/** Shown at once when a review opens, while its report and chat load. */
export default function LoadingReview() {
  return (
    <div className="p-6 text-muted-foreground">
      <LatticeLoader label="Loading the review…" showTimer={false} />
    </div>
  );
}
