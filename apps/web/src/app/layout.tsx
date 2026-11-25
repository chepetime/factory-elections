import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Software Factory', template: '%s · Software Factory' },
  description: 'Local task-to-pull-request factory',
  applicationName: 'Software Factory',
};

// `modal` holds route-backed dialogs (app/@modal); it renders nothing on other routes.
export default function RootLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans text-foreground antialiased">
        <AppShell>
          {children}
          {modal}
        </AppShell>
      </body>
    </html>
  );
}
