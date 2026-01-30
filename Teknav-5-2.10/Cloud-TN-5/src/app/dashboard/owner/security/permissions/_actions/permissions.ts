'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

/**
 * Permissions Server Actions
 */

const setTenantPermissionsSchema = z.object({
  permissions: z.record(z.any()),
});

const setWorkspacePermissionsSchema = z.object({
  permissions: z.record(z.any()),
});

export async function getDefaultPermissions() {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/security/permissions`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch permissions: ${error}`);
  }

  const data = await response.json();
  return data;
}

export async function setTenantPermissions(tenantId: string, formData: FormData) {
  const validated = setTenantPermissionsSchema.parse(Object.fromEntries(formData));
  const payload = { permissions: validated.permissions };

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/security/permissions/tenant/${tenantId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to set permissions: ${error}`);
  }

  revalidatePath('/dashboard/owner/security/permissions');
  redirect('/dashboard/owner/security/permissions');
}

export async function setWorkspacePermissions(workspaceId: string, formData: FormData) {
  const validated = setWorkspacePermissionsSchema.parse(Object.fromEntries(formData));
  const payload = { permissions: validated.permissions };

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/security/permissions/workspace/${workspaceId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to set permissions: ${error}`);
  }

  revalidatePath('/dashboard/owner/security/permissions');
  redirect('/dashboard/owner/security/permissions');
}

export async function resetPermissions(formData: FormData) {
  const validated = Object.fromEntries(formData);

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/security/permissions/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validated),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to reset permissions: ${error}`);
  }

  revalidatePath('/dashboard/owner/security/permissions');
  redirect('/dashboard/owner/security/permissions');
}

export async function requestPermissionChange(formData: FormData) {
  const validated = Object.fromEntries(formData);

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/admin/security/permissions/request-change`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validated),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to request change: ${error}`);
  }

  revalidatePath('/dashboard/admin/security/permissions');
}
