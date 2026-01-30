'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

/**
 * Admin Security Sessions Server Actions
 */

export async function revokeSession(sessionId: string) {
  // Real implementation would call backend
  // await fetch(`${BACKEND_URL}/api/security/sessions/${sessionId}`, { method: 'DELETE' });
  
  revalidatePath('/dashboard/admin/security/sessions');
  // No redirect, just refresh list
}

export async function revokeAllUserSessions(userId: string) {
  // Real implementation would call backend
  // await fetch(`${BACKEND_URL}/api/security/sessions/user/${userId}`, { method: 'DELETE' });

  revalidatePath('/dashboard/admin/security/sessions');
}

export async function getSessions() {
  // Real implementation would call backend
  // const res = await fetch(`${BACKEND_URL}/api/security/sessions`);
  return { data: [], total: 0 };
}
