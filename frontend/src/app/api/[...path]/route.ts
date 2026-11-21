import type { NextRequest } from 'next/server';
import { authCookies, backendUrl } from '@/lib/api/upstream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, context: Context): Promise<Response> {
  const fail = (status: number, message: string) => Response.json({ statusCode: status, error: status === 403 ? 'Forbidden' : 'Service Unavailable', message }, { status, headers: { 'Cache-Control': 'no-store' } });
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  // Validate BEFORE adapting headers for the fixed, private backend hop.
  if (write && (request.headers.get('origin') !== request.nextUrl.origin || request.headers.get('sec-fetch-site') === 'cross-site')) {
    return fail(403, 'Cross-origin request rejected');
  }
  const { path } = await context.params;
  if (path.some(segment => !segment || segment === '.' || segment === '..' || /[\\/]/u.test(segment))) return fail(403, 'Invalid API path');
  try {
    const origin = backendUrl();
    const target = new URL(`/api/${path.map(encodeURIComponent).join('/')}`, origin);
    target.search = request.nextUrl.search;
    const headers = new Headers();
    for (const name of ['accept', 'content-type', 'range']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set('cookie', authCookies(request.headers.get('cookie') || ''));
    if (write) {
      headers.set('origin', origin.origin);
      headers.set('sec-fetch-site', 'same-origin');
    }
    const upstream = await fetch(target, {
      method: request.method, headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(30000),
    });
    const responseHeaders = new Headers({ 'Cache-Control': 'no-store' });
    for (const name of ['content-type', 'content-disposition', 'retry-after', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append('Set-Cookie', cookie);
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch { return fail(503, 'The API is temporarily unavailable. Please try again.'); }
}
export { proxy as GET, proxy as HEAD, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE, proxy as OPTIONS };
