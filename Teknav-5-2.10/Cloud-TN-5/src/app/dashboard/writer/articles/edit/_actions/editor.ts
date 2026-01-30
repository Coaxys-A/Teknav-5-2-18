'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

/**
 * Article Editor Server Actions
 */

const articleUpdateSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  excerpt: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

const templateApplySchema = z.object({
  context: z.record(z.any()),
});

const aiToolSchema = z.object({
  model: z.string(),
  tool: z.string(),
  selectionRange: z.object({ start: z.number(), end: z.number() }).optional(),
  instructions: z.string().optional(),
});

export async function getArticle(id: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/articles/${id}`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch article: ${error}`);
  }

  const data = await response.json();
  return data;
}

export async function updateArticle(id: string, formData: FormData) {
  const validated = articleUpdateSchema.parse(Object.fromEntries(formData));
  
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/articles/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validated),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update article: ${error}`);
  }

  revalidatePath(`/dashboard/writer/articles/edit/${id}`);
  redirect(`/dashboard/writer/articles/edit/${id}`);
}

export async function submitForReview(id: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/articles/${id}/submit`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to submit: ${error}`);
  }

  redirect(`/dashboard/writer/articles`);
}

export async function publishArticle(id: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/articles/${id}/publish`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to publish: ${error}`);
  }

  redirect(`/dashboard/writer/articles`);
}

export async function applyTemplate(id: string, templateId: string, formData: FormData) {
  const validated = templateApplySchema.parse(Object.fromEntries(formData));
  
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/templates/article/${templateId}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validated),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to apply template: ${error}`);
  }

  revalidatePath(`/dashboard/writer/articles/edit/${id}`);
  redirect(`/dashboard/writer/articles/edit/${id}`);
}

export async function aiTranslate(id: string, targetLang: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/articles/${id}/translations/${targetLang}/ai-translate`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to enqueue translation: ${error}`);
  }

  revalidatePath(`/dashboard/writer/articles/edit/${id}`);
  redirect(`/dashboard/writer/articles/edit/${id}`);
}

export async function generateAltText(id: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/media/${id}/ai-alttext`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to generate alt text: ${error}`);
  }

  revalidatePath(`/dashboard/writer/articles/edit/${id}`);
  redirect(`/dashboard/writer/articles/edit/${id}`);
}
