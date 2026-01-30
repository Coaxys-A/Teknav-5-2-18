import { redirect } from 'next/navigation';

/**
 * Writer Main Page
 *
 * Redirects to /dashboard/writer/articles.
 */

export default function WriterPage() {
  redirect('/dashboard/writer/articles');
}
