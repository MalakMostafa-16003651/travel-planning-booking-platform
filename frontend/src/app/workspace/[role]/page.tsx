import { notFound } from 'next/navigation';
import { workspaceRoles } from '@/config/routes';
import { Workspace } from '@/features/auth/workspace';
export default async function WorkspacePage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  if (!Object.hasOwn(workspaceRoles, role)) notFound();
  const requiredRole = workspaceRoles[role];
  if (!requiredRole) notFound();
  return <Workspace role={requiredRole} />;
}
