import type { Metadata } from 'next';
import { RegisterForm } from '@/features/auth/register-form';

export const metadata: Metadata = { title: 'Create an account' };

export default function RegisterPage() {
  return (
    <section className="auth-shell">
      <div className="auth-card">
        <h1>Create an account</h1>
        <p className="muted">Save your preferences and manage your trips in one place.</p>
        <RegisterForm />
      </div>
    </section>
  );
}
