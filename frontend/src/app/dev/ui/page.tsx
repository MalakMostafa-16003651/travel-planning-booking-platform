import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorAlert } from "@/components/ui/error-alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/ui/loading-state";
import { Select } from "@/components/ui/select";
import { ConfirmationPreview } from "./confirmation-preview";

export const dynamic = "force-dynamic";

export default function UiGalleryPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <div className="page-container page-content stack">
      <div>
        <p className="eyebrow">Development only</p>
        <h1 className="section-heading">Shared UI foundation</h1>
        <p className="muted">Coastal Editorial tokens and basic primitives. Preview controls illustrate appearance; they perform no account actions.</p>
      </div>
      <Card>
        <h2 className="mb-6">Actions</h2>
        <div className="flex flex-wrap gap-3">
          <Button>Primary action</Button>
          <Button variant="secondary">Secondary action</Button>
          <Button variant="danger">Destructive action</Button>
          <Button disabled>Saving…</Button>
          <ConfirmationPreview />
        </div>
      </Card>
      <div className="gallery-grid">
        <Card className="stack">
          <h2 className="m-0">Form fields</h2>
          <FormField id="gallery-name" label="Full name" hint="Use the name you prefer.">
            <Input placeholder="Your full name" />
          </FormField>
          <FormField id="gallery-email" label="Email address" error="Enter a valid email address.">
            <Input type="email" defaultValue="invalid-email" />
          </FormField>
          <FormField id="gallery-currency" label="Preferred currency">
            <Select defaultValue="USD">
              <option value="USD">USD — US Dollar</option>
              <option value="EGP">EGP — Egyptian Pound</option>
            </Select>
          </FormField>
        </Card>
        <Card className="stack">
          <h2 className="m-0">Clear feedback</h2>
          <ErrorAlert title="Unable to save" message="Please check your connection and try again." />
          <LoadingState label="Loading your account…" />
          <EmptyState title="No saved trips yet" description="Your saved trips will appear here." />
          <div className="flex flex-wrap gap-2">
            <Badge>Draft</Badge>
            <Badge tone="info">In review</Badge>
            <Badge tone="success">Confirmed</Badge>
            <Badge tone="warning">Payment pending</Badge>
            <Badge tone="danger">Cancelled</Badge>
          </div>
        </Card>
      </div>
      <Card>
        <h2 className="mb-6">Shared palette</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="gallery-swatch bg-ink text-white">Ink<br />#102A43</div>
          <div className="gallery-swatch bg-primary text-white">Primary teal<br />#0E7490</div>
          <div className="gallery-swatch bg-sand text-ink">Sand accent<br />#D5A66C</div>
          <div className="gallery-swatch bg-canvas text-body">Canvas<br />#F7F9FA</div>
        </div>
      </Card>
    </div>
  );
}
