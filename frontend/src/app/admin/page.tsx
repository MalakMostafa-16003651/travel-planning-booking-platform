import type { Metadata } from 'next';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { AdminNav, adminSections } from '@/features/admin/admin-nav';
import { AdminAccessDenied } from '@/features/admin/page-states';
import { requireAdmin } from '@/features/admin/server';

// Rendering: dynamic SSR. The admin landing page checks the session on every request.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Administration', robots: { index: false } };

export default async function AdminHomePage() {
  const admin = await requireAdmin('/admin');
  if (!admin) return <AdminAccessDenied />;

  return (
    <div className="page-container page-content stack content-start">
      <div>
        <p className="eyebrow">Administration</p>
        <h1 className="m-0">Welcome, {admin.name}</h1>
        <p className="muted mb-0">Manage accounts and keep the platform safe. Every action you take here is recorded in the audit log.</p>
      </div>
      <AdminNav current="/admin" />
      <div className="gallery-grid">
        {adminSections.map(section => (
          <Card key={section.href} className="grid content-start gap-2">
            <h2 className="m-0 text-xl"><Link href={section.href}>{section.label}</Link></h2>
            <p className="m-0 text-sm text-muted">{section.description}</p>
            <p className="m-0 text-xs text-muted">{section.ids}</p>
          </Card>
        ))}
        <Card className="grid content-start gap-2">
          <h2 className="m-0 text-xl"><Link href="/notifications">Notifications</Link></h2>
          <p className="m-0 text-sm text-muted">Your own inbox, also available from the bell in the header.</p>
          <p className="m-0 text-xs text-muted">GEN-01</p>
        </Card>
      </div>
    </div>
  );
}
