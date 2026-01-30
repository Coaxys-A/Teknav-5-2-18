/**
 * CSRF Client Helper
 * 
 * Provides a `fetchWithCsrf` wrapper that automatically
 * fetches token from `/api/csrf`, sets cookie, and adds header.
 */

let csrfTokenPromise: Promise<string> | null = null;

/**
 * Fetch CSRF Token
 * Called once per session (or per page load).
 */
export async function getCsrfToken(): Promise<string> {
  if (csrfTokenPromise) {
    return csrfTokenPromise;
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/csrf`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch CSRF token');
  }

  const data = await response.json();
  csrfTokenPromise = Promise.resolve(data.token);
  return data.token;
}

/**
 * Fetch with CSRF Token
 * Adds `x-csrf-token` header to all mutation requests.
 */
export async function fetchWithCsrf(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getCsrfToken();

  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  headers.set('x-csrf-token', token);

  return fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });
}
