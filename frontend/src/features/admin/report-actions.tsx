'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, apiClient } from '@/lib/api/client';
import { ActionDialog } from './action-dialog';
import { targetTypeLabels, type AdminReport } from './moderation-types';

type Action = 'DISMISS' | 'HIDE' | 'DELETE';

/** GEN-10: resolve one open report. HIDE and DELETE act on the content and close every open report about it. */
export function ReportActions({ report }: { report: AdminReport }) {
  const router = useRouter();
  const [notice, setNotice] = useState('');
  const noun = targetTypeLabels[report.targetType].toLowerCase();

  if (report.status !== 'OPEN') return <span className="text-sm text-muted">Closed</span>;

  async function resolve(action: Action) {
    try {
      await apiClient(`/admin/reports/${report.reportId}`, { method: 'PATCH', body: JSON.stringify({ action }) });
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) throw new Error('This report was already resolved, maybe by another admin. Reload to see its current status.');
      if (cause instanceof ApiError && cause.status === 404) throw new Error('This report no longer exists.');
      throw new Error(cause instanceof ApiError ? cause.message : 'Please try again.');
    }
    setNotice(action === 'DISMISS' ? 'Report dismissed.' : action === 'HIDE' ? `The ${noun} is hidden and its open reports are closed.` : `The ${noun} is deleted and its open reports are closed.`);
    router.refresh();
  }

  const who = report.userName ? ` from ${report.userName}` : '';
  return (
    <div className="grid justify-items-start gap-2">
      <div className="flex flex-wrap gap-2">
        <ActionDialog
          triggerLabel="Dismiss"
          triggerAriaLabel={`Dismiss report${who}`}
          title="Dismiss this report?"
          description={<>Only this report is closed. The {noun} stays visible, and other reports about it stay open.</>}
          submitLabel="Dismiss report"
          pendingLabel="Dismissing…"
          onOpen={() => setNotice('')}
          onSubmit={() => resolve('DISMISS')}
        />
        <ActionDialog
          triggerLabel="Hide"
          triggerAriaLabel={`Hide the reported ${noun}${who}`}
          title={`Hide this ${noun}?`}
          description={<>Only its author and administrators will see it. Every open report about it is closed. You can unhide it later from Content.</>}
          submitLabel={`Hide ${noun}`}
          pendingLabel="Hiding…"
          onOpen={() => setNotice('')}
          onSubmit={() => resolve('HIDE')}
        />
        <ActionDialog
          triggerLabel="Delete"
          triggerVariant="danger"
          triggerAriaLabel={`Delete the reported ${noun}${who}`}
          title={`Delete this ${noun}?`}
          description={<>This cannot be undone. Related data is removed too (for a post, its comments, likes and images). Every open report about it is closed.</>}
          submitLabel={`Delete ${noun}`}
          submitVariant="danger"
          pendingLabel="Deleting…"
          onOpen={() => setNotice('')}
          onSubmit={() => resolve('DELETE')}
        />
      </div>
      {notice && <p role="status" className="m-0 max-w-xs whitespace-normal text-sm text-success">{notice}</p>}
    </div>
  );
}
