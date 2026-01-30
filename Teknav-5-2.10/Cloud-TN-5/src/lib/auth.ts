import { getMeAction } from '@/app/dashboard/writer/_actions/auth';

/**
 * Auth Lib (Server)
 *
 * Server-side helper to load current user session + memberships.
 * Calls Server Action `getMe`.
 */

export async function getAuthUser() {
  try {
    const user = await getMeAction();
    return user;
  } catch (error) {
    return null;
  }
}
