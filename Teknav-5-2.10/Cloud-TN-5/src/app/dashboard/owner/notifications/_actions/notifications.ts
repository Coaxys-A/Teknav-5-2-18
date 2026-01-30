'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

/**
 * Admin Notifications Server Actions
 */

export async function markNotificationsRead(ids: number[]) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/admin/notifications/read`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to mark read: ${error}`);
  }

  revalidatePath('/dashboard/owner/notifications');
  revalidatePath('/dashboard/admin/notifications');
}

export async function retryNotification(notificationId: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/admin/notifications/${notificationId}/retry`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to retry: ${error}`);
  }

  revalidatePath('/dashboard/owner/notifications');
}

export async function purgeNotifications(olderThanDays: number, status?: string) {
  const body: { olderThanDays: number; status?: string } = { olderThanDays };
  if (status) body.status = status;

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/admin/notifications/purge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to purge: ${error}`);
  }

  revalidatePath('/dashboard/owner/notifications');
  revalidatePath('/dashboard/admin/notifications');
}

export async function replayDlqJob(jobId: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/admin/notifications/dlq/${jobId}/replay`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to replay: ${error}`);
  }

  revalidatePath('/dashboard/owner/notifications');
}
