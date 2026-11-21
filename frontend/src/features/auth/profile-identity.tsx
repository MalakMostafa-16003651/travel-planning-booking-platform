'use client';
import { RequireSession } from './require-session';
import { useSession } from './session-provider';
export function ProfileIdentity() {
  const { user } = useSession();
  return <RequireSession><section className="auth-shell"><div className="auth-card stack"><p className="eyebrow">Your account</p><h1>Account profile</h1><p className="muted">Your live account identity.</p><dl className="grid gap-4"><div><dt>Name</dt><dd>{user?.name}</dd></div><div><dt>Email</dt><dd>{user?.email}</dd></div><div><dt>Role</dt><dd>{user?.role}</dd></div><div><dt>Status</dt><dd>{user?.status}</dd></div></dl></div></section></RequireSession>;
}
