'use server';

import { z } from 'zod';

/**
 * Health Actions (Server Actions)
 * M11 - Queue Platform: "Queue Health Page"
 */

export async function getQueueHealth() {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/health`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch queue health: ${error}`);
  }

  return await response.json();
}

export async function getCircuitStatuses() {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/circuits`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch circuit statuses: ${error}`);
  }

  return await response.json();
}

export async function resetCircuit(dependencyName: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/circuits/${dependencyName}/reset`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to reset circuit: ${error}`);
  }

  return await response.json();
}

export async function clearRateLimits(dependencyName: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/circuits/${dependencyName}/clear-ratelimits`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to clear rate limits: ${error}`);
  }

  return await response.json();
}

export async function getSlaStats(hours?: number) {
  const params = hours ? `?hours=${hours}` : '';
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/sla${params}`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch SLA stats: ${error}`);
  }

  return await response.json();
}

export async function getWorkerStatus() {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/workers`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch worker status: ${error}`);
  }

  return await response.json();
}
