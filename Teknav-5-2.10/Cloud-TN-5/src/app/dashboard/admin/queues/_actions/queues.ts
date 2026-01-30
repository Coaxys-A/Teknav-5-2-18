'use server';

import { getStats } from '../../owner/queues/_actions/queues';

export async function getAdminStats() {
  return await getStats();
}
