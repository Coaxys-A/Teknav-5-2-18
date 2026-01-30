'use server';

import { redirect } from 'next/navigation';

/**
 * Timeline Server Actions
 */

export async function getGlobalTimeline(filters: any) {
  const params = new URLSearchParams();
  if (filters.workspaceId) params.set('workspaceId', filters.workspaceId);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.type) params.set('type', filters.type);
  if (filters.from) params.set('from', filters.from.toISOString());
  if (filters.to) params.set('to', filters.to.toISOString());
  if (filters.page) params.set('page', filters.page);
  if (filters.pageSize) params.set('pageSize', filters.pageSize);
  if (filters.sort) params.set('sort', filters.sort);

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/admin/timeline?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch timeline: ${error}`);
  }

  return await response.json();
}

export async function getEntityTimeline(entityType: string, entityId: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/admin/timeline/entity/${entityType}/${entityId}`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch timeline: ${error}`);
  }

  return await response.json();
}
