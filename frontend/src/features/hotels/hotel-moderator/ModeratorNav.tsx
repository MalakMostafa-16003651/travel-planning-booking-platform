import Link from "next/link";

const links = [
  { href: "/moderator/hotel", label: "Profile & photos" },
  { href: "/moderator/hotel/rooms", label: "Rooms" },
  { href: "/moderator/hotel/availability", label: "Availability" },
  { href: "/moderator/hotel/policies", label: "Policies" },
  { href: "/moderator/hotel/reservations", label: "Reservations" },
];

export function ModeratorNav() {
  return (
    <nav aria-label="Hotel moderator sections" className="flex flex-wrap gap-2 border-b border-border pb-4">
      {links.map(link => (
        <Link key={link.href} href={link.href} className="rounded-control border border-border px-3 py-2 text-sm font-semibold text-ink no-underline hover:border-primary hover:text-primary">
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export function AccessDenied() {
  return (
    <div className="page-container page-content stack">
      <h1>Access denied</h1>
      <p>Your account cannot open the hotel moderator dashboard.</p>
      <Link href="/">Back to home</Link>
    </div>
  );
}
