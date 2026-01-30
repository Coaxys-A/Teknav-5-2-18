'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';

/**
 * Article Lifecycle Server Actions
 */

const submitSchema = z.object({}); // Empty body
const scheduleSchema = z.object({ publishedAt: z.string() });
const rejectSchema = z.object({ reason: z.string() });
const autosaveSchema = z.object({
  title: z.string().min(1),
  excerpt: z.string().optional(),
  content: z.string().optional(),
  categoryId: z.number().optional(),
});

export async function submitArticle(id: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/writer/articles/${id}/submit`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to submit article: ${error}`);
  }

  revalidatePath('/dashboard/writer/articles');
  revalidatePath(`/dashboard/writer/articles/${id}/edit`);
  
  const data = await response.json();
  return data.data;
}

export async function scheduleArticle(id: string, formData: FormData) {
  const validated = scheduleSchema.parse(formData);

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/writer/articles/${id}/schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validated),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to schedule article: ${error}`);
  }

  revalidatePath('/dashboard/writer/articles');
  revalidatePath(`/dashboard/writer/articles/${id}/edit`);

  const data = await response.json();
  return data.data;
}

export async function rejectArticle(id: string, formData: FormData) {
  const validated = rejectSchema.parse(formData);

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/writer/articles/${id}/reject`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validated),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to reject article: ${error}`);
  }

  revalidatePath('/dashboard/writer/articles');
  revalidatePath(`/dashboard/writer/articles/${id}/edit`);

  const data = await response.json();
  return data.data;
}

export async function approveArticle(id: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/writer/articles/${id}/approve`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to approve article: ${error}`);
  }

  revalidatePath('/dashboard/writer/articles');
  revalidatePath(`/dashboard/writer/articles/${id}/edit`);

  const data = await response.json();
  return data.data;
}

export async function publishArticle(id: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/writer/articles/${id}/publish`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to publish article: ${error}`);
  }

  revalidatePath('/dashboard/writer/articles');
  revalidatePath('/dashboard/writer/articles/${id}/edit`);

  const data = await response.json();
  return data.data;
}

export async function autosaveArticle(id: string, formData: FormData) {
  const validated = autosaveSchema.parse(formData);

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/writer/articles/${id}/autosave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validated),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to autosave article: ${error}`);
  }

  // No revalidate for autosave (it's volatile)
  return true;
}

export async function getAutosave(id: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/writer/articles/${id}/autosave`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    // Swallow error for autosave
    return null;
  }

  const data = await response.json();
  return data.data;
}

export async function deleteAutosave(id: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/writer/articles/${id}/autosave`, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to delete autosave: ${error}`);
  }

  return true;
}

export async function getVersions(id: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/writer/articles/${id}/versions`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch versions');
  }

  const data = await response.json();
  return data.data;
}

export async function revertArticle(id: string, versionNumber: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/writer/articles/${id}/revert/${versionNumber}`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to revert article: ${error}`);
  }

  revalidatePath('/dashboard/writer/articles');
  revalidatePath(`/dashboard/writer/articles/${id}/edit`);

  const data = await response.json();
  return data.data;
}
