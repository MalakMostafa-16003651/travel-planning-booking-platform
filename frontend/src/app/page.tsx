import Link from "next/link";
import { ArrowRight, Compass, Layers3, ShieldCheck } from "lucide-react";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="page-container hero-grid">
          <div>
            <p className="eyebrow">A little more intention. A world of possibility.</p>
            <h1>Every good journey starts with a shared plan.</h1>
            <p className="hero-description">One place for the details that bring a trip together. Start with your account while our shared travel experience takes shape.</p>
            <div className="hero-actions">
              <Link href="/login" className={buttonClassName()}>Sign in to your account <ArrowRight size={18} aria-hidden="true" /></Link>
              <Link href="/account/profile" className={buttonClassName("secondary")}>Open account</Link>
            </div>
          </div>
          <aside className="hero-note">
            <p className="eyebrow">Milestone 2 · Shared foundation</p>
            <h2>One team.<br />One experience.</h2>
            <p>This starter establishes our sign-in flow and shared design language. Flight, hotel, itinerary and story features will arrive through their owners’ reviewed contributions.</p>
          </aside>
        </div>
      </section>
      <section className="foundation-section" aria-labelledby="foundation-heading">
        <div className="page-container">
          <h2 id="foundation-heading" className="section-heading">A thoughtful foundation</h2>
          <div className="foundation-grid">
            <Card>
              <ShieldCheck className="feature-icon" size={28} strokeWidth={1.5} aria-hidden="true" />
              <h3>Your account, protected</h3>
              <p>Sign in through our existing backend, with secure cookies and permissions checked by the API.</p>
            </Card>
            <Card>
              <Layers3 className="feature-icon" size={28} strokeWidth={1.5} aria-hidden="true" />
              <h3>Familiar at every step</h3>
              <p>Shared forms, clear feedback and a consistent visual language connect each part of the experience.</p>
            </Card>
            <Card>
              <Compass className="feature-icon" size={28} strokeWidth={1.5} aria-hidden="true" />
              <h3>Room for what comes next</h3>
              <p>The team’s travel features will build on this foundation, using the same routes, components and API conventions.</p>
            </Card>
          </div>
        </div>
      </section>
    </>
  );
}
