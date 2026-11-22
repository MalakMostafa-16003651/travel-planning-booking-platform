'use client';

import { useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { loginHref } from '@/config/routes';
import { apiClient, ApiError } from '@/lib/api/client';
import type { AuthenticatedUser } from '@/types/auth';
import { passwordError, passwordHint } from './password-rules';

type RegistrationField = 'name' | 'email' | 'password' | 'termsAccepted';
type FieldErrors = Partial<Record<RegistrationField, string>>;
const fields: RegistrationField[] = ['name', 'email', 'password', 'termsAccepted'];

export function RegisterForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const returnTo = search.get('returnTo');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    const email = String(data.get('email') ?? '').trim();
    const password = String(data.get('password') ?? '');
    const termsAccepted = data.has('termsAccepted');

    const validation: FieldErrors = {};
    if (!name) validation.name = 'Enter your name.';
    else if ([...name].length > 120) validation.name = 'Use at most 120 characters.';
    if (!email || (form.elements.namedItem('email') as HTMLInputElement).validity.typeMismatch) {
      validation.email = 'Enter a valid email address.';
    }
    const invalidPassword = passwordError(password);
    if (invalidPassword) validation.password = invalidPassword;
    if (!termsAccepted) validation.termsAccepted = 'Accept the terms and privacy policy to continue.';
    setError('');
    setErrors(validation);
    const firstInvalid = fields.find(field => validation[field]);
    if (firstInvalid) {
      (form.elements.namedItem(firstInvalid) as HTMLInputElement).focus();
      return;
    }

    submitting.current = true;
    setBusy(true);
    try {
      await apiClient<AuthenticatedUser>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password, termsAccepted }),
      });
      router.replace(loginHref(returnTo, { registered: '1' }));
    } catch (failure) {
      if (failure instanceof ApiError) {
        const fieldErrors: FieldErrors = {};
        for (const field of fields) {
          const message = failure.fields[field]?.[0];
          if (message) fieldErrors[field] = message;
        }
        if (failure.status === 409 && !fieldErrors.email) fieldErrors.email = failure.message;
        setErrors(fieldErrors);
        const first = fields.find(field => fieldErrors[field]);
        if (first) {
          (form.elements.namedItem(first) as HTMLInputElement).focus();
        } else {
          setError(failure.message);
        }
      } else {
        setError('We could not create your account. Try again.');
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <form method="post" onSubmit={submit} noValidate aria-busy={busy}>
      {error && <ErrorAlert message={error} />}
      <FormField id="register-name" label="Name" error={errors.name}>
        <Input name="name" autoComplete="name" required />
      </FormField>
      <FormField id="register-email" label="Email" error={errors.email}>
        <Input name="email" type="email" autoComplete="email" required maxLength={254} />
      </FormField>
      <FormField id="register-password" label="Password" hint={passwordHint} error={errors.password}>
        <Input name="password" type="password" autoComplete="new-password" required />
      </FormField>
      <div className="grid gap-2">
        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-ink">
          <input
            type="checkbox"
            name="termsAccepted"
            required
            className="mt-1 size-4 shrink-0 accent-primary"
            aria-invalid={!!errors.termsAccepted}
            aria-describedby={errors.termsAccepted ? 'register-consent-error' : undefined}
          />
          <span>I accept the terms and privacy policy.</span>
        </label>
        {errors.termsAccepted && <p id="register-consent-error" className="text-sm text-danger">{errors.termsAccepted}</p>}
      </div>
      <Button type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</Button>
      <p className="text-sm">Already have an account? <Link className="underline" href={loginHref(returnTo)}>Sign in</Link></p>
    </form>
  );
}
