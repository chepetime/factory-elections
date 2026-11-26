import { notFound } from 'next/navigation';

// The children slot for a URL that only the @modal catch-all matches (e.g. an API route or an
// asset). Next's strict route matching needs it; it never renders for a real page.
export default function Default() {
  notFound();
}
