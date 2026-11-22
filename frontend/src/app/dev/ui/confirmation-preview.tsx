"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function ConfirmationPreview() {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <ConfirmDialog
        triggerLabel="Preview confirmation"
        title="Remove the sample item?"
        description="This action previews a confirmation in the component gallery."
        confirmLabel="Remove sample"
        onConfirm={() => setConfirmed(true)}
      />
      <span role="status" className="text-sm text-muted">{confirmed && "Sample removal confirmed."}</span>
    </div>
  );
}
