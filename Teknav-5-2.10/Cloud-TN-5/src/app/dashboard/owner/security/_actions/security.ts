'use server';

import { z } from 'zod';

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

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/security/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update settings: ${error}`);
  }

  return await response.json();
}

export async function getCsrfToken() {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/security/csrf`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch CSRF token: ${error}`);
  }

  return await response.json();
}
