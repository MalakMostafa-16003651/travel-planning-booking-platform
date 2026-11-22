import type { Metadata } from 'next';
import { ResetPasswordForm } from '@/features/auth/reset-password-form';

export const metadata: Metadata = { title: 'Reset password', robots: { index: false } };

export default function ResetPasswordPage() {
  return (
    <section className="auth-shell">
      <div className="auth-card stack">
        <h1>Reset password</h1>
        <ResetPasswordForm />
      </div>
    </section>
  );
}
