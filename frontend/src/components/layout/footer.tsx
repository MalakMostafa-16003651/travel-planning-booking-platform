import Link from "next/link";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="page-container site-footer-inner">
        <p className="font-semibold text-ink">Travel Planning &amp; Booking</p>
        <p>Thoughtfully planned. Together.</p>
        <Link href="/login" className="inline-flex min-h-11 items-center text-sm">Your account</Link>
      </div>
    </footer>
  );
}
