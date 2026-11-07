/** Initial read-only airport catalog supplied in Mock Data.xlsx (Airports.csv). */
export const AIRPORT_SEEDS = [
  { code: 'CAI', name: 'Cairo International Airport', city: 'Cairo', country: 'Egypt', timeZone: 'Africa/Cairo' },
  { code: 'DXB', name: 'Dubai International Airport', city: 'Dubai', country: 'United Arab Emirates', timeZone: 'Asia/Dubai' },
  { code: 'LHR', name: 'Heathrow Airport', city: 'London', country: 'United Kingdom', timeZone: 'Europe/London' },
  { code: 'JFK', name: 'John F. Kennedy International Airport', city: 'New York', country: 'United States', timeZone: 'America/New_York' },
  { code: 'CDG', name: 'Charles de Gaulle Airport', city: 'Paris', country: 'France', timeZone: 'Europe/Paris' },
  { code: 'HND', name: 'Haneda Airport', city: 'Tokyo', country: 'Japan', timeZone: 'Asia/Tokyo' },
  { code: 'RUH', name: 'King Khalid International Airport', city: 'Riyadh', country: 'Saudi Arabia', timeZone: 'Asia/Riyadh' },
  { code: 'FRA', name: 'Frankfurt Airport', city: 'Frankfurt', country: 'Germany', timeZone: 'Europe/Berlin' },
] as const;
