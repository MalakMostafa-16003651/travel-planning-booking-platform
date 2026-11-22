import type { ReactNode } from 'react';

type HomeSlots = {
  flightSearch?: ReactNode;
  hotelSearch?: ReactNode;
  itineraries?: ReactNode;
  stories?: ReactNode;
};

// Feature owners supply data and behavior. The landing page owns placement.
export function HomeContent({ flightSearch, hotelSearch, itineraries, stories }: HomeSlots) {
  const sections = [
    { id: 'flight-search', title: 'Find a flight', content: flightSearch },
    { id: 'hotel-search', title: 'Find a stay', content: hotelSearch },
    { id: 'public-itineraries', title: 'Explore itineraries', content: itineraries },
    { id: 'travel-stories', title: 'Travel stories', content: stories },
  ].filter(section => section.content != null);

  return (
    <>
      {sections.map(({ id, title, content }) => (
        <section key={id} className="grid gap-4 py-8" aria-labelledby={id}>
          <h2 id={id}>{title}</h2>
          {content}
        </section>
      ))}
    </>
  );
}
