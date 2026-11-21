import { redirect } from 'next/navigation';
import { ProfileIdentity } from '@/features/auth/profile-identity';
import { getServerSession } from '@/lib/api/server-session';
export const dynamic = 'force-dynamic';
export default async function ProfilePage() {
  const user = await getServerSession();
  if (!user) redirect('/login?returnTo=%2Faccount%2Fprofile');
  return <ProfileIdentity />;
}
