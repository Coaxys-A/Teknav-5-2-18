/**
 * API Client
 *
 * Typed fetch wrapper for server components.
 * Handles:
 * - Cookie forwarding
 * - Error parsing
 * - Base URL
 */

const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3000';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface ApiResponse<T> {
  data: T;
  error?: string;
  message?: string;
}

export async function api<T = any>(
  url: string,
  options: {
    method?: HttpMethod;
    body?: any;
    headers?: Record<string, string>;
  } = {},
): Promise<ApiResponse<T>> {
  const { method = 'GET', body, headers: customHeaders = {} } = options;

  const requestHeaders: HeadersInit = {
    'Content-Type': 'application/json',
    ...customHeaders,
  };

  // Add CSRF Token if available (from helper)
  // In Server Components, we can't access cookies easily via `document.cookie`.
  // We rely on Next.js to forward cookies automatically.
  // If we need CSRF explicitly, we'd add the header here.

  const response = await fetch(`${BASE_URL}${url}`, {
    method,
    headers: requestHeaders,
    body: body ? JSON.stringify(body) : undefined,
    // credentials: 'include' is handled by Next.js cookies forwarding automatically
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({} as ApiResponse<T>));
    throw new Error(errorData.message || errorData.error || `API Error: ${response.status}`);
  }

  return await response.json();
}

export const apiClient = {
  get: <T>(url: string, options?: Omit<typeof options, 'body' | 'method'>) => api<T>(url, { ...options, method: 'GET' }),
  post: <T>(url: string, body?: any) => api<T>(url, { method: 'POST', body }),
  put: <T>(url: string, body?: any) => api<T>(url, { method: 'PUT', body }),
  patch: <T>(url: string, body?: any) => api<T>(url, { method: 'PATCH', body }),
  delete: <T>(url: string) => api<T>(url, { method: 'DELETE' }),
};
