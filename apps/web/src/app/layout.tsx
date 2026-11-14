import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Software Factory',
  description: 'Local task-to-pull-request factory',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <header className="border-b">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
            <Link href="/" className="font-semibold">
              Software Factory
            </Link>
            <nav aria-label="Main navigation" className="ml-auto flex items-center gap-4 text-sm">
              <Link href="/" className="text-muted-foreground underline-offset-4 hover:underline">
                Projects
              </Link>
              <Link href="/components" className="text-muted-foreground underline-offset-4 hover:underline">
                Components
              </Link>
            </nav>
            <span className="hidden text-xs text-muted-foreground sm:inline">local · localhost</span>
          </div>
        </header>
        <div className="mx-auto max-w-6xl px-4 py-6">{children}</div>
      </body>
    </html>
  );
}
