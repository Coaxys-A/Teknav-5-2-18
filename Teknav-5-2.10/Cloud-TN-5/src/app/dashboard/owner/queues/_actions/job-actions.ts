'use server';

import { z } from 'zod';

/**
 * Job Detail Actions (Server Actions)
 * M11 - Queue Platform: "Job Detail Page"
 */

export async function getJobDetails(queueName: string, aiJobId: number) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/${queueName}/jobs/${aiJobId}`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch job details: ${error}`);
  }

  return await response.json();
}

export async function getJobEvents(queueName: string, aiJobId: number) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/${queueName}/jobs/${aiJobId}/events`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch job events: ${error}`);
  }

  return await response.json();
}

export async function getJobLogs(queueName: string, aiJobId: number) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/${queueName}/jobs/${aiJobId}/logs`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch job logs: ${error}`);
  }

  return await response.json();
}

export async function replayJobWithNewPayload(
  queueName: string,
  aiJobId: number,
  newIdempotencyKey?: string,
  updates?: any,
) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/${queueName}/jobs/${aiJobId}/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      newIdempotencyKey,
      payloadUpdates: updates,
    }),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to replay job: ${error}`);
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
