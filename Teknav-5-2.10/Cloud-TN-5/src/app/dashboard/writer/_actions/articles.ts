'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

/**
 * Articles Server Actions
 */

const createArticleSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255, 'Title too long'),
  excerpt: z.string().optional(),
  content: z.string().optional(),
  categoryId: z.number().optional(),
});

const updateArticleSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  excerpt: z.string().optional(),
  content: z.string().optional(),
  categoryId: z.number().optional(),
});

export async function createArticle(formData: FormData) {
  const validated = createArticleSchema.parse(formData);

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/writer/articles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(validated),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create article: ${error}`);
  }

  const data = await response.json();

  revalidatePath('/dashboard/writer/articles');
  revalidatePath('/dashboard/writer/articles/[id]/edit');

  redirect(`/dashboard/writer/articles/${data.data.id}/edit`);
}

export async function updateArticle(id: string, formData: FormData) {
  const validated = updateArticleSchema.parse(formData);

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/writer/articles/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(validated),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update article: ${error}`);
  }

  revalidatePath('/dashboard/writer/articles/[id]/edit');
  // Return true for success UI feedback (optional)
  return true;
}

export async function getWriterArticles(page: string, pageSize: string, status: string, q: string) {
  const params = new URLSearchParams({
    page,
    pageSize,
    ...(status && { status }),
    ...(q && { q }),
  });

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/writer/articles?${params.toString()}`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch articles');
  }

  return await response.json();
}

export async function getArticleById(id: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/writer/articles/${id}`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch article');
  }

  return (await response.json()).data;
}
