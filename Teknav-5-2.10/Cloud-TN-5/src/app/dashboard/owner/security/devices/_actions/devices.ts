'use server';

/**
 * Security Device Actions
 */

export async function listDevices(query: {
  page?: string;
  pageSize?: string;
}) {
  const params = new URLSearchParams();
  if (query.page) params.set('page', query.page);
  if (query.pageSize) params.set('pageSize', query.pageSize);

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/security/devices?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to list devices: ${error}`);
  }

  return await response.json();
}

export async function updateDeviceTrust(formData: FormData) {
  const body = {
    id: formData.get('id'),
    trusted: formData.get('trusted') === 'true',
  };

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/security/devices/${body.id}/trust`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update device: ${error}`);
  }

  return await response.json();
}
