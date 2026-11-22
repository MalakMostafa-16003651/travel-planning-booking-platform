import type { Metadata } from 'next';
import { Suspense } from 'react';
import { VerifyEmailForm } from '@/features/auth/verify-email-form';

export const metadata: Metadata = { title: 'Verify email', robots: { index: false } };

export default function VerifyEmailPage() {
  return (
    <section className="auth-shell">
      <div className="auth-card stack">
        <h1>Verify your email</h1>
        <Suspense fallback={<p role="status">Checking the verification link…</p>}>
          <VerifyEmailForm />
        </Suspense>
      </div>
    </section>
  );
}
