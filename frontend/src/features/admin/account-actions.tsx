'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { passwordError, passwordHint } from '@/features/auth/password-rules';
import { ApiError, apiClient } from '@/lib/api/client';
import { ActionDialog, DialogField, FieldError } from './action-dialog';
import type { AdminAccount } from './types';

/**
 * ACC-16 suspend/reactivate and ACC-07a temporary password for one account row.
 * Administrators get no actions (the backend refuses them). Self-deactivated accounts cannot be
 * reactivated here (ACC-12), but an admin can still set a temporary password.
 */
export function AccountActions({ account }: { account: AdminAccount }) {
  const router = useRouter();
  const [notice, setNotice] = useState('');

  if (account.role === 'ADMIN') return <span className="text-sm text-muted">No actions</span>;

  const done = (message: string) => { setNotice(message); router.refresh(); };

  async function changeStatus(action: 'suspend' | 'reactivate', form: FormData) {
    const reason = String(form.get('reason') ?? '').trim();
    if (reason && (reason.length < 3 || reason.length > 500)) throw new FieldError('reason', 'Reason must be 3 to 500 characters, or leave it empty.');
    try {
      await apiClient(`/admin/accounts/${account.userId}/${action}`, { method: 'PATCH', body: JSON.stringify(reason ? { reason } : {}) });
    } catch (cause) {
      throw new Error(statusMessage(cause, action));
    }
    done(action === 'suspend' ? `${account.name} is suspended.` : `${account.name} is active again.`);
  }

  async function resetPassword(form: FormData) {
    const temporaryPassword = String(form.get('temporaryPassword') ?? '');
    const invalid = passwordError(temporaryPassword);
    if (invalid) throw new FieldError('temporaryPassword', invalid);
    try {
      await apiClient(`/admin/users/${account.userId}/reset-password`, { method: 'POST', body: JSON.stringify({ temporaryPassword }) });
    } catch (cause) {
      if (cause instanceof ApiError && cause.fields.temporaryPassword?.length) throw new FieldError('temporaryPassword', cause.fields.temporaryPassword[0]);
      throw new Error(cause instanceof ApiError && cause.status === 404 ? 'This account no longer exists.' : cause instanceof ApiError ? cause.message : 'Please try again.');
    }
    done(`Temporary password set for ${account.name}. Give it to them privately; they must change it when they next sign in.`);
  }

  const reasonField = (fieldErrors: Record<string, string>) => (
    <DialogField id={`reason-${account.userId}`} label="Reason (optional)" hint="Saved in the audit log. 3 to 500 characters." error={fieldErrors.reason}>
      {(describedBy, invalid) => <textarea id={`reason-${account.userId}`} name="reason" rows={3} maxLength={500} aria-describedby={describedBy} aria-invalid={invalid} className="w-full rounded-control border border-border bg-card px-3 py-2.5 text-base text-body aria-invalid:border-danger" />}
    </DialogField>
  );

  return (
    <div className="grid justify-items-start gap-2">
      <div className="flex flex-wrap gap-2">
        {account.status === 'ACTIVE' && (
          <ActionDialog
            triggerLabel="Suspend"
            triggerAriaLabel={`Suspend ${account.name}`}
            triggerVariant="danger"
            title={`Suspend ${account.name}?`}
            description={<>They will be signed out and cannot sign in until reactivated. Their bookings stay valid and their content stays visible. They get a notification.</>}
            submitLabel="Suspend account"
            submitVariant="danger"
            pendingLabel="Suspending…"
            onOpen={() => setNotice('')}
            onSubmit={form => changeStatus('suspend', form)}
          >
            {reasonField}
          </ActionDialog>
        )}
        {account.status === 'SUSPENDED' && (
          <ActionDialog
            triggerLabel="Reactivate"
            triggerAriaLabel={`Reactivate ${account.name}`}
            title={`Reactivate ${account.name}?`}
            description="They can sign in again and get a notification."
            submitLabel="Reactivate account"
            pendingLabel="Reactivating…"
            onOpen={() => setNotice('')}
            onSubmit={form => changeStatus('reactivate', form)}
          >
            {reasonField}
          </ActionDialog>
        )}
        <ActionDialog
          triggerLabel="Reset password"
          triggerAriaLabel={`Reset password for ${account.name}`}
          title={`Set a temporary password for ${account.name}`}
          description={<>Their current sessions end, and they must choose a new password at their next sign-in. The account status does not change. The password is not emailed: give it to them privately.</>}
          submitLabel="Set temporary password"
          pendingLabel="Setting…"
          onOpen={() => setNotice('')}
          onSubmit={resetPassword}
        >
          {fieldErrors => (
            <DialogField id={`temp-${account.userId}`} label="Temporary password" hint={passwordHint} error={fieldErrors.temporaryPassword}>
              {(describedBy, invalid) => <Input id={`temp-${account.userId}`} name="temporaryPassword" type="text" autoComplete="off" spellCheck={false} maxLength={128} aria-describedby={describedBy} aria-invalid={invalid} />}
            </DialogField>
          )}
        </ActionDialog>
      </div>
      {account.status === 'DEACTIVATED' && <span className="text-sm text-muted">Closed by the user</span>}
      {notice && <p role="status" className="m-0 max-w-xs whitespace-normal text-sm text-success">{notice}</p>}
    </div>
  );
}

function statusMessage(cause: unknown, action: 'suspend' | 'reactivate'): string {
  if (!(cause instanceof ApiError)) return 'Please try again.';
  if (cause.status === 409) return action === 'suspend' ? 'This account is no longer active. Reload to see its current status.' : 'This account is no longer suspended. Reload to see its current status.';
  if (cause.status === 404) return 'This account no longer exists.';
  return cause.message || 'Please try again.';
}
