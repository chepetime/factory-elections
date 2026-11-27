import { LatticeLoader } from '@factory/ui/components/lattice-loader';

/** The chat list stays; only the thread waits for its messages. */
export default function LoadingChat() {
  return (
    <div className="p-6 text-muted-foreground">
      <LatticeLoader label="Loading the chat…" showTimer={false} />
    </div>
  );
}
