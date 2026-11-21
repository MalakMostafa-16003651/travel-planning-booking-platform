export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  errors?: Record<string, string[]>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public fields: Record<string, string[]> = {}) {
    super(message);
    this.name = 'ApiError';
  }
}

// Browser calls only. Server Components use getServerSession or their own cookie-forwarding adapter.
export async function apiClient<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw new Error('Use an API-relative path');
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, headers, credentials: 'include', cache: 'no-store' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'Unable to connect. Check your connection and try again.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as ApiErrorBody | null;
    // Credential/proof endpoints can return 401 for bad input without revoking a valid session.
    const credentialCheck = ['/auth/me', '/auth/login', '/auth/change-password', '/auth/reset-password', '/auth/verify-email'].includes(path);
    if (response.status === 401 && !credentialCheck && typeof window !== 'undefined') window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(response.status, body?.message || 'The request could not be completed. Please try again.', body?.errors);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
