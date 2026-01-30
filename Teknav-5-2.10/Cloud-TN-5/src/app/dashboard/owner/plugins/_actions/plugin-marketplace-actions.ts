'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';

/**
 * Plugin Marketplace Actions (Server Actions)
 * PART 12 - Plugin Platform: "Marketplace + Install/Upgrade/Rollback + Permissions Matrix + Signing Enforcement + WASM Sandbox Hardening + Event Pipelines + Rate Limits + Logs + Analytics Attribution"
 */

export async function getMarketplacePlugins(options: {
  page?: number;
  pageSize?: number;
  q?: string;
  categoryId?: number;
  tags?: string[];
  visibility?: 'PUBLIC' | 'PRIVATE';
  isEnabled?: boolean;
  sort?: 'name' | 'createdAt' | 'installs';
} = {}) {
  const params = new URLSearchParams();
  if (options.page) params.append('page', options.page.toString());
  if (options.pageSize) params.append('pageSize', options.pageSize.toString());
  if (options.q) params.append('q', options.q);
  if (options.categoryId) params.append('categoryId', options.categoryId.toString());
  if (options.tags && options.tags.length > 0) {
    params.append('tags', options.tags.join(','));
  }
  if (options.visibility) params.append('visibility', options.visibility);
  if (options.isEnabled !== undefined) {
    params.append('isEnabled', options.isEnabled.toString());
  }
  if (options.sort) params.append('sort', options.sort);

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/plugins/marketplace?${params}`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch marketplace plugins: ${error}`);
  }

  const data = await response.json();
  revalidatePath('/dashboard/owner/plugins/marketplace');
  return data;
}

export async function getPluginById(pluginId: number) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/plugins/${pluginId}`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch plugin: ${error}`);
  }

  const data = await response.json();
  revalidatePath(`/dashboard/owner/plugins/${pluginId}`);
  return data;
}

export async function createPlugin(input: {
  key: string;
  name: string;
  description: string;
  slot: string;
  type: string;
  tags: string[];
  visibility: 'PUBLIC' | 'PRIVATE';
  categoryId: number;
  manifest?: any;
  isEnabled?: boolean;
}) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/plugins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create plugin: ${error}`);
  }

  const data = await response.json();
  revalidatePath('/dashboard/owner/plugins/marketplace');
  return data;
}

export async function updatePlugin(pluginId: number, updates: any) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/plugins/${pluginId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update plugin: ${error}`);
  }

  const data = await response.json();
  revalidatePath('/dashboard/owner/plugins/marketplace');
  return data;
}

export async function enablePlugin(pluginId: number) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/plugins/${pluginId}/enable`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to enable plugin: ${error}`);
  }

  const data = await response.json();
  revalidatePath('/dashboard/owner/plugins/marketplace');
  return data;
}

export async function disablePlugin(pluginId: number) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/plugins/${pluginId}/disable`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to disable plugin: ${error}`);
  }

  const data = await response.json();
  revalidatePath('/dashboard/owner/plugins/marketplace');
  return data;
}

export async function getCategories() {
  // In production, this would fetch from backend
  // For now, we'll return mock categories (used in marketplace page)
  return {
    data: [
      { id: 1, name: 'CMS' },
      { id: 2, name: 'AI' },
      { id: 3, name: 'Analytics' },
      { id: 4, name: 'Communication' },
      { id: 5, name: 'Workflow' },
      { id: 6, name: 'Utilities' },
    ],
  };
}
