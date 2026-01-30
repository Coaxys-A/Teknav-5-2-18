'use server';

import { redirect } from 'next/navigation';

/**
 * Auth Server Actions
 */

export async function logoutAction() {
  // Invalidate session (call backend /api/auth/logout)
  await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });

  redirect('/auth/login');
}

export async function getMeAction() {
  const me = await getMe();
  return me;
}

// Helper to fetch /api/me
async function getMe() {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/me`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch user info');
  }

  const data = await response.json();
  return data.data;
}
