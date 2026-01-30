'use server';

import { z } from 'zod';

/**
 * Quarantine Actions (Server Actions)
 * M11 - Queue Platform: "Quarantine Lane (Innovation)"
 */

export async function getQuarantinedJobs(
  queueName: string,
  options: {
    page?: number;
    pageSize?: number;
    reason?: string;
    search?: string;
  } = {},
) {
  const params = new URLSearchParams();
  if (options.page) params.append('page', options.page.toString());
  if (options.pageSize) params.append('pageSize', options.pageSize.toString());
  if (options.reason) params.append('reason', options.reason);
  if (options.search) params.append('search', options.search);

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/${queueName}/quarantine?${params}`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch quarantined jobs: ${error}`);
  }

  return await response.json();
}

export async function promoteToDlq(queueName: string, jobId: string, aiJobId: number) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/${queueName}/quarantine/${jobId}/promote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aiJobId }),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to promote job: ${error}`);
  }

  return await response.json();
}

export async function deleteQuarantinedJob(queueName: string, jobId: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/${queueName}/quarantine/${jobId}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to delete quarantined job: ${error}`);
  }

  return await response.json();
}

export async function bulkDeleteQuarantine(queueName: string, jobIds: string[]) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/${queueName}/quarantine/bulk-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobIds }),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to bulk delete quarantined jobs: ${error}`);
  }

  return await response.json();
}

export async function clearQuarantine(queueName: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/${queueName}/quarantine/clear`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to clear quarantine: ${error}`);
  }

  return await response.json();
}

export async function getQuarantineStats(queueName: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/${queueName}/quarantine/stats`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch quarantine stats: ${error}`);
  }

  return await response.json();
}
