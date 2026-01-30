'use server';

import { z } from 'zod';

/**
 * DLQ Actions (Server Actions)
 * M11 - Queue Platform: "DLQ + Replay UI"
 */

export async function getDlqJobs(
  queueName: string,
  options: {
    page?: number;
    pageSize?: number;
    errorType?: string;
    search?: string;
  } = {},
) {
  const params = new URLSearchParams();
  if (options.page) params.append('page', options.page.toString());
  if (options.pageSize) params.append('pageSize', options.pageSize.toString());
  if (options.errorType) params.append('errorType', options.errorType);
  if (options.search) params.append('search', options.search);

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/${queueName}/dlq?${params}`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch DLQ jobs: ${error}`);
  }

  return await response.json();
}

export async function replayJob(queueName: string, jobId: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/${queueName}/dlq/${jobId}/replay`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to replay job: ${error}`);
  }

  return await response.json();
}

export async function deleteDlqJob(queueName: string, jobId: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/${queueName}/dlq/${jobId}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to delete DLQ job: ${error}`);
  }

  return await response.json();
}

export async function bulkReplayJobs(queueName: string, jobIds: string[]) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/${queueName}/dlq/bulk-replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobIds }),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to bulk replay jobs: ${error}`);
  }

  return await response.json();
}

export async function clearDlq(queueName: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/${queueName}/dlq/clear`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to clear DLQ: ${error}`);
  }

  return await response.json();
}

export async function getDlqStats(queueName: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/${queueName}/dlq/stats`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch DLQ stats: ${error}`);
  }

  return await response.json();
}
