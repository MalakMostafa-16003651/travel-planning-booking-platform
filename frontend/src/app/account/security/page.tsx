import type { Metadata } from 'next';
import { SecurityForm } from '@/features/auth/security-form';
export const metadata: Metadata = { title: 'Account security' };
export default function SecurityPage() {
  return <section className="auth-shell"><div className="auth-card stack"><p className="eyebrow">Keep your account safe</p><h1>Account security</h1><SecurityForm /></div></section>;
}
