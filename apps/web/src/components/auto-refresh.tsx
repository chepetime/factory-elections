'use client';
// Re-renders the page every few seconds while background work is running.
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function AutoRefresh({ everyMs = 3000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
