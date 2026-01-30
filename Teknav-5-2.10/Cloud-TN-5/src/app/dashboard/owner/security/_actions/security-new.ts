'use server';

import { z } from 'zod';
import { getCsrfToken as getCsrfTokenFromApi } from './security';

/**
 * Security Settings Server Action
 */

export async function getSecuritySettings() {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/security/settings`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch settings: ${error}`);
  }

  return await response.json();
}

export async function updateSecuritySettings(formData: FormData) {
  const body = {
    rateLimits: formData.get('rateLimits'),
    bruteForce: formData.get('bruteForce'),
    sessionTtl: formData.get('sessionTtl'),
    requireCsrf: formData.get('requireCsrf') === 'true',
  };

  // Get CSRF token if required
  const csrfToken = formData.get('requireCsrf') === 'true'
  ? await getCsrfTokenFromApi().then(res => res.csrfToken)
  : null;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/security/settings`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update settings: ${error}`);
  }

  return await response.json();
}

// Re-export for convenience
export { getCsrfTokenFromApi as getCsrfToken };
