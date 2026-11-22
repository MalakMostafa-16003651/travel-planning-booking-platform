'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorAlert } from '@/components/ui/error-alert';
import { LoadingState } from '@/components/ui/loading-state';
import { roleLabels } from '@/config/routes';
import { apiClient } from '@/lib/api/client';
import type { AccountStatus, AuthenticatedUser } from '@/types/auth';
import { ProfileEditor, type UserProfile } from './profile-editor';
import { RequireSession } from './require-session';
import { useSession } from './session-provider';

const statusLabels: Record<AccountStatus, string> = {
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  DEACTIVATED: 'Deactivated',
};

function ProfileDetails({ viewer }: { viewer: AuthenticatedUser }) {
  const { clear, refresh } = useSession();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const current = await apiClient<UserProfile>('/users/me', { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (current.userId !== viewer.userId) {
          setError('Your session changed. Try loading your profile again.');
          await refresh();
          return;
        }
        setProfile(current);
      } catch (error) {
        if (controller.signal.aborted) return;
        setError(error instanceof Error ? error.message : 'Your profile could not be loaded.');
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt, refresh, viewer.userId]);

  async function deactivate() {
    await apiClient<void>('/users/me/deactivate', {
      method: 'POST',
      headers: { 'X-Expected-User-Id': viewer.userId },
      body: JSON.stringify({ confirmed: true }),
    });
    clear();
    window.location.replace('/login?deactivated=1');
  }

  return (
    <section className="mx-auto grid max-w-4xl gap-6" aria-labelledby="account-profile-heading">
      <div className="grid gap-2">
        <h1 id="account-profile-heading">Account profile</h1>
        <p className="text-muted">Manage your contact details and travel preferences.</p>
      </div>

      <Card>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
          <div className="min-w-0">
            <dt className="text-sm font-semibold text-muted">Email</dt>
            <dd className="break-all">{viewer.email}</dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-muted">Role</dt>
            <dd>{roleLabels[viewer.role]}</dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-muted">Account status</dt>
            <dd className="mt-1">
              <Badge tone={viewer.status === 'ACTIVE' ? 'success' : 'neutral'}>{statusLabels[viewer.status]}</Badge>
            </dd>
          </div>
        </dl>
        {viewer.role === 'USER' && (
          <Link className="mt-3 inline-block text-sm font-semibold underline" href="/verify-email">
            Email verification
          </Link>
        )}
      </Card>

      {profile ? (
        <ProfileEditor
          profile={profile}
          onSaving={setSaving}
          onSaved={(updated) => {
            setProfile(updated);
            void refresh();
          }}
        />
      ) : error ? (
        <Card className="grid gap-4">
          <ErrorAlert title="Profile unavailable" message={error} />
          <Button className="justify-self-start" variant="secondary" onClick={() => {
            setError('');
            setAttempt((current) => current + 1);
          }}>
            Try again
          </Button>
        </Card>
      ) : <LoadingState label="Loading your profile…" />}

      {viewer.role === 'USER' && (
        <Card className="grid gap-4 border-danger/30" aria-labelledby="deactivation-heading">
          <div className="grid gap-2">
            <h2 id="deactivation-heading">Account deactivation</h2>
            <p className="text-sm text-muted">Deactivation ends your sessions and prevents future sign-ins. Resolve any upcoming confirmed bookings first.</p>
          </div>
          <div>
            <ConfirmDialog
              triggerLabel="Deactivate account"
              title="Deactivate your account?"
              description="You’ll be signed out on every device and lose access to this account. Your public itineraries and published posts will be hidden. Existing comments and reviews will appear under Deleted user."
              confirmLabel="Confirm deactivation"
              pendingLabel="Deactivating…"
              variant="danger"
              disabled={saving}
              onConfirm={deactivate}
            />
          </div>
        </Card>
      )}
    </section>
  );
}

export function ProfileIdentity() {
  const { user } = useSession();
  return (
    <RequireSession>
      {user && <ProfileDetails key={user.userId} viewer={user} />}
    </RequireSession>
  );
}
