import type { Metadata } from 'next';
import { LoginForm } from '@/features/auth/login-form';
export const metadata: Metadata = { title: 'Sign in' };
export default function LoginPage() {
  return <section className="auth-shell"><div className="auth-card stack"><p className="eyebrow">Your next chapter</p><h1>Welcome back</h1><p className="muted">Sign in to your travel workspace.</p><LoginForm /></div></section>;
}
