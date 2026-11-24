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

// Browser calls only, same /api proxy as apiClient. XMLHttpRequest (not fetch) is what
// gives upload progress; GEN-08 uploads (photos/images/logos) are the one place that matters.
export function uploadFile<T>(path: string, field: string, file: File, onProgress?: (percent: number) => void, signal?: AbortSignal): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw new Error('Use an API-relative path');
  const form = new FormData();
  form.append(field, file);
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    xhr.withCredentials = true;
    xhr.responseType = 'json';
    if (signal) {
      if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      signal.addEventListener('abort', () => xhr.abort());
    }
    xhr.upload.onprogress = event => { if (onProgress && event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); };
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    xhr.onerror = () => reject(new ApiError(0, 'Unable to connect. Check your connection and try again.'));
    xhr.onload = () => {
      const body = xhr.response as ApiErrorBody | T | null;
      if (xhr.status >= 200 && xhr.status < 300) { resolve(body as T); return; }
      if (xhr.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('session-expired'));
      const errorBody = body as ApiErrorBody | null;
      reject(new ApiError(xhr.status, errorBody?.message || 'The request could not be completed. Please try again.', errorBody?.errors));
    };
    xhr.send(form);
  });
}
