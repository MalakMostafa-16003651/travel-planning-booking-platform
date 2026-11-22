import type { Metadata } from 'next';
import { LoginForm } from '@/features/auth/login-form';
export const metadata: Metadata = { title: 'Sign in' };
export default function LoginPage() {
  return (
    <section className="auth-shell">
      <div className="auth-card">
        <h1>Sign in</h1>
        <LoginForm />
      </div>
    </section>
  );
}
