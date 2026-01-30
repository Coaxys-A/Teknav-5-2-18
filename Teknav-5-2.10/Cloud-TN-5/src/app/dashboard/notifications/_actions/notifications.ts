'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

/**
 * User Notifications Server Actions
 */

export async function getUserNotifications(filters: any) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.page) params.set('page', filters.page);
  if (filters.pageSize) params.set('pageSize', filters.pageSize);

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/me/notifications?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch notifications: ${error}`);
  }

  return await response.json();
}

export async function markNotificationsRead(ids: number[]) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/me/notifications/read`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to mark read: ${error}`);
  }

  revalidatePath('/dashboard/notifications');
}
