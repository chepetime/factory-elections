import { LatticeLoader } from '@factory/ui/components/lattice-loader';

export default function LoadingTickets() {
  return (
    <div className="p-6 text-muted-foreground">
      <LatticeLoader label="Loading tickets…" showTimer={false} />
    </div>
  );
}
