'use server';

/**
 * Security Ban Actions
 */

export async function createBan(formData: FormData) {
  const body = {
    kind: formData.get('kind'), // 'ip' | 'user'
    target: formData.get('target'), // IP or UserID
    ttlSeconds: parseInt(formData.get('ttlSeconds') || '3600'), // 1 hour default
    reason: formData.get('reason'),
  };

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/security/bans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create ban: ${error}`);
  }

  return await response.json();
}

export async function removeBan(formData: FormData) {
  const body = {
    kind: formData.get('kind'),
    target: formData.get('target'),
  };

  const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/security/bans`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to remove ban: ${error}`);
  }

  return await response.json();
}
