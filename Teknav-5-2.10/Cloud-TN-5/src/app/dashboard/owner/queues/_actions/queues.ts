'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

/**
 * Queues Server Actions
 */

export async function getStats() {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/stats`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch stats: ${error}`);
  }

  return await response.json();
}

export async function enqueueAiContent(formData: FormData) {
  const articleId = formData.get('articleId');
  const workspaceId = formData.get('workspaceId');
  const model = formData.get('model');
  const promptTemplateId = formData.get('promptTemplateId');

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/ai-content`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      articleId: parseInt(articleId as string),
      workspaceId: parseInt(workspaceId as string),
      model: model as string,
      promptTemplateId: parseInt(promptTemplateId as string),
    }),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to enqueue: ${error}`);
  }

  revalidatePath('/dashboard/owner/queues');
  redirect('/dashboard/owner/queues');
}

export async function enqueueWorkflow(formData: FormData) {
  const data = Object.fromEntries(formData);
  
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/workflow-execution`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to enqueue: ${error}`);
  }

  revalidatePath('/dashboard/owner/queues');
  redirect('/dashboard/owner/queues');
}

export async function retryDlqJob(queueName: string, jobId: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/dlq/${jobId}/retry`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to retry: ${error}`);
  }

  revalidatePath('/dashboard/owner/queues/dlq');
}

export async function discardDlqJob(queueName: string, jobId: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/dlq/${jobId}/discard`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to discard: ${error}`);
  }

  revalidatePath('/dashboard/owner/queues/dlq');
}

export async function getDlq() {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/queues/dlq`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch DLQ: ${error}`);
  }

  return await response.json();
}
