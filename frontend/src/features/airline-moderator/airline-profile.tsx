'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert } from '@/components/ui/error-alert';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { LoadingState } from '@/components/ui/loading-state';
import { ApiError, apiClient } from '@/lib/api/client';
import type { Airline } from './types';

export function AirlineProfile() {
  const [airline, setAirline] = useState<Airline | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [logoError, setLogoError] = useState('');
  const [logoVersion, setLogoVersion] = useState(0);

  useEffect(() => {
    let alive = true; // ignore a response that arrives after the view was reset for another account
    apiClient<Airline>('/airlines/me')
      .then(a => { if (alive) { setAirline(a); setName(a.name); setCode(a.code); } })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Could not load your airline.'); });
    return () => { alive = false; };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice(''); setFields({});
    try {
      const updated = await apiClient<Airline>('/airlines/me', { method: 'PATCH', body: JSON.stringify({ name: name.trim(), code: code.trim().toUpperCase() }) });
      setAirline(updated); setNotice('Airline profile saved.');
    } catch (e) {
      if (e instanceof ApiError) { setError(e.message); setFields(e.fields); } else setError('Could not save.');
    } finally { setBusy(false); }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setLogoError('');
    if (!['image/png', 'image/jpeg'].includes(file.type)) return setLogoError('Choose a JPG or PNG image.');
    if (file.size > 5 * 1024 * 1024) return setLogoError('The image must be 5 MB or smaller.');
    const body = new FormData();
    body.append('logo', file);
    try {
      setAirline(await apiClient<Airline>('/airlines/me/logo', { method: 'POST', body }));
      setLogoVersion(v => v + 1);
    } catch (e) { setLogoError(e instanceof Error ? e.message : 'Upload failed.'); }
  }

  if (!airline && !error) return <LoadingState label="Loading your airline…" />;
  if (!airline) return <ErrorAlert message={error} />;
  return (
    <Card className="grid gap-4 md:max-w-xl">
      <h1 className="m-0">Airline profile</h1>
      {airline.logo && <img src={`/api/airlines/${airline._id}/logo?v=${logoVersion}`} alt={`${airline.name} logo`} className="h-16 w-auto max-w-40 object-contain" />}
      <FormField id="logo" label="Logo (JPG or PNG, max 5 MB)" error={logoError}>
        <Input type="file" accept="image/png,image/jpeg" onChange={e => void upload(e.target.files?.[0])} />
      </FormField>
      <form onSubmit={save} className="grid gap-4" noValidate>
        {error && <ErrorAlert message={error} />}
        {notice && <p role="status" className="m-0 text-sm text-ink">{notice}</p>}
        <FormField id="al-name" label="Airline name" error={fields.name?.[0]}><Input value={name} maxLength={120} onChange={e => setName(e.target.value)} /></FormField>
        <FormField id="al-code" label="Airline code" hint="2–8 letters or digits, for example MS." error={fields.code?.[0]}><Input value={code} maxLength={8} onChange={e => setCode(e.target.value.toUpperCase())} /></FormField>
        <div><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button></div>
      </form>
    </Card>
  );
}
