'use server';

import { z } from 'zod';

/**
 * Queue Overview Actions (Server Actions)
 * M11 - Queue Platform: "Owner UI — Queue Observatory"
 */

export async function getQueuesOverview() {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch queues overview: ${error}`);
  }

  return await response.json();
}

export async function getQueueStats(queueName: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/${queueName}/stats`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch queue stats: ${error}`);
  }

  return await response.json();
}

export async function getQueueJobs(
  queueName: string,
  options: {
    page?: number;
    pageSize?: number;
    status?: string;
    jobType?: string;
    search?: string;
  } = {},
) {
  const params = new URLSearchParams();
  if (options.page) params.append('page', options.page.toString());
  if (options.pageSize) params.append('pageSize', options.pageSize.toString());
  if (options.status) params.append('status', options.status);
  if (options.jobType) params.append('jobType', options.jobType);
  if (options.search) params.append('search', options.search);

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/${queueName}/jobs?${params}`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch queue jobs: ${error}`);
  }

  return await response.json();
}

export async function retryJob(queueName: string, aiJobId: number) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/${queueName}/jobs/${aiJobId}/retry`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to retry job: ${error}`);
  }

  return await response.json();
}

export async function cancelJob(queueName: string, aiJobId: number) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/${queueName}/jobs/${aiJobId}/cancel`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to cancel job: ${error}`);
  }

  return await response.json();
}

export async function pauseQueue(queueName: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/${queueName}/pause`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to pause queue: ${error}`);
  }

  return await response.json();
}

export async function resumeQueue(queueName: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/${queueName}/resume`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to resume queue: ${error}`);
  }

  return await response.json();
}

export async function cleanQueue(queueName: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/${queueName}/clean`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to clean queue: ${error}`);
  }

  return await response.json();
}

export async function getQueueHealth(queueName: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/${queueName}/health`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch queue health: ${error}`);
  }

  return await response.json();
}
