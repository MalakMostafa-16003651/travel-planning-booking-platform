import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { loginHref } from '@/config/routes';
import { ProfileIdentity } from '@/features/auth/profile-identity';
import { getServerSession } from '@/lib/api/server-session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Account profile' };

export default async function ProfilePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getServerSession();
  if (!user) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(await searchParams)) {
      if (Array.isArray(value)) {
        for (const item of value) query.append(key, item);
      } else if (value !== undefined) {
        query.append(key, value);
      }
    }
    redirect(loginHref(`/account/profile${query.size ? `?${query}` : ''}`));
  }
  return <ProfileIdentity />;
}
