import type { Metadata } from 'next';
import { Suspense } from 'react';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import './globals.css';
import { AppHeader } from '@/components/layout/app-header';
import { Footer } from '@/components/layout/footer';
import { SessionProvider } from '@/features/auth/session-provider';
import { SessionActions } from '@/features/auth/session-actions';
import { HeaderAccount } from '@/features/auth/header-account';
import { NotificationBell } from '@/features/notifications';

export const metadata: Metadata = { title: { default: 'Travel Planning & Booking', template: '%s | Travel Planning' }, description: 'Plan thoughtful journeys with the Travel Planning and Booking Platform.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <AppHeader notificationSlot={<NotificationBell />} accountSlot={<HeaderAccount />} />
          <SessionActions />
          <main id="main-content" className="page-container page-content">
            <Suspense fallback={<p role="status">Loading...</p>}>{children}</Suspense>
          </main>
          <Footer />
        </SessionProvider>
      </body>
    </html>
  );
}
