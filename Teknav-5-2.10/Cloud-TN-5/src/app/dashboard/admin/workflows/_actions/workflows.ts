'use server';

import { redirect } from 'next/navigation';

/**
 * Workflow Server Actions
 */

export async function runWorkflow(workflowId: string, input?: Record<string, any>, triggerContext?: Record<string, any>) {
  const body = JSON.stringify({ input, triggerContext });

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/admin/workflows/${workflowId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to run workflow: ${error}`);
  }

  redirect(`/dashboard/admin/workflows/instances?workflowId=${workflowId}`);
}

export async function rerunWorkflow(workflowId: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/admin/workflows/${workflowId}/rerun`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to rerun workflow: ${error}`);
  }

  redirect(`/dashboard/admin/workflows/instances?workflowId=${workflowId}`);
}

export async function cancelInstance(instanceId: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/admin/workflows/instances/${instanceId}/cancel`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to cancel instance: ${error}`);
  }

  // Revalidate list
  // We can't easily revalidate `/dashboard/admin/workflows/instances` with dynamic query.
  // Redirecting back to list is fine.
}

export async function getInstances(filters: any) {
  const params = new URLSearchParams();
  if (filters.workflowId) params.set('workflowId', filters.workflowId);
  if (filters.status) params.set('status', filters.status);
  if (filters.page) params.set('page', filters.page);
  if (filters.pageSize) params.set('pageSize', filters.pageSize);
  if (filters.sort) params.set('sort', filters.sort);
  if (filters.order) params.set('order', filters.order);

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/admin/workflows/instances?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch instances');
  }

  return await response.json();
}

export async function getInstance(instanceId: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/admin/workflows/instances/${instanceId}`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch instance');
  }

  return (await response.json()).data;
}

export async function getInstanceSteps(instanceId: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/admin/workflows/instances/${instanceId}/steps`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch instance steps');
  }

  return (await response.json()).data;
}
