import Link from 'next/link';
import { buttonClassName } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { PublicSearch } from './server';

export const SORT_LABELS: Record<NonNullable<PublicSearch['sort']>, string> = {
  NEWEST: 'Newest first', OLDEST: 'Oldest first', TITLE: 'Title A–Z', SHORTEST: 'Shortest trip', LONGEST: 'Longest trip',
};

/**
 * ITN-21 filters as a plain GET form: the URL is the state, so results are shareable,
 * survive refresh/back, and work before JavaScript loads.
 */
export function PublicFilters({ search, countries, cities, errors }: {
  search: PublicSearch;
  countries: { code: string; name: string }[];
  cities: { cityId: string; name: string; countryCode: string }[];
  errors: Partial<Record<'q' | 'minDays' | 'maxDays', string>>;
}) {
  const visibleCities = search.country ? cities.filter(city => city.countryCode === search.country) : cities;
  return (
    <form method="get" action="/explore/itineraries" className="grid gap-4 rounded-card border border-border bg-card p-5" role="search" aria-label="Search public itineraries">
      <div className="grid items-start gap-4 md:grid-cols-2 lg:grid-cols-3">
        <FormField id="explore-q" label="Keyword" hint="Matches title, description, country or city." error={errors.q}>
          <Input name="q" type="search" defaultValue={search.q ?? ''} maxLength={100} />
        </FormField>
        <FormField id="explore-country" label="Country">
          <Select name="country" defaultValue={search.country ?? ''}>
            <option value="">Any country</option>
            {countries.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}
          </Select>
        </FormField>
        <FormField id="explore-city" label="City">
          <Select name="city" defaultValue={search.city ?? ''}>
            <option value="">Any city</option>
            {[...visibleCities].sort((a, b) => a.name.localeCompare(b.name)).map(city => <option key={city.cityId} value={city.name}>{city.name}</option>)}
          </Select>
        </FormField>
        <FormField id="explore-min" label="Minimum days" error={errors.minDays}>
          <Input name="minDays" type="number" min={1} max={60} inputMode="numeric" defaultValue={search.minDays ?? ''} />
        </FormField>
        <FormField id="explore-max" label="Maximum days" error={errors.maxDays}>
          <Input name="maxDays" type="number" min={1} max={60} inputMode="numeric" defaultValue={search.maxDays ?? ''} />
        </FormField>
        <FormField id="explore-sort" label="Sort by">
          <Select name="sort" defaultValue={search.sort ?? 'NEWEST'}>
            {Object.entries(SORT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </FormField>
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={buttonClassName('primary')}>Search</button>
        <Link href="/explore/itineraries" className={buttonClassName('secondary')}>Clear filters</Link>
      </div>
    </form>
  );
}
