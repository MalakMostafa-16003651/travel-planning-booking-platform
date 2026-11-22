import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/features/auth/forgot-password-form';

export const metadata: Metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage() {
  return (
    <section className="auth-shell">
      <div className="auth-card stack">
        <h1>Forgot password</h1>
        <ForgotPasswordForm />
      </div>
    </section>
  );
}
