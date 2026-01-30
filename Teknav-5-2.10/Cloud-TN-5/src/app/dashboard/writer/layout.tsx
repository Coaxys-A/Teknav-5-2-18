'use client';

import { ReactNode, useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { WriterSidebar } from '@/components/dashboard/writer/sidebar';
import { WriterTopbar } from '@/components/dashboard/writer/topbar';
import { Breadcrumbs } from '@/components/shared/breadcrumbs';

export default function WriterLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ label: string; href?: string }>>([]);

  useEffect(() => {
    // Generate breadcrumbs based on pathname
    const items: Array<{ label: string; href?: string }> = [];
    
    // Base
    items.push({ label: 'Writer', href: '/dashboard/writer' });

    // Path analysis
    if (pathname === '/dashboard/writer/articles') {
      items.push({ label: 'Articles' });
    } else if (pathname.startsWith('/dashboard/writer/articles/new')) {
      items.push({ label: 'New Article' });
    } else if (pathname.startsWith('/dashboard/writer/articles/')) {
      // /dashboard/writer/articles/[id]/edit
      items.push({ label: 'Articles', href: '/dashboard/writer/articles' });
      items.push({ label: 'Edit Article' });
    } else if (pathname === '/dashboard/writer/settings') {
      items.push({ label: 'Settings' });
    }

    setBreadcrumbs(items);
  }, [pathname]);

  return (
    <div className="flex h-screen bg-background">
      <div className="w-64 border-r bg-card">
        <WriterSidebar />
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        <WriterTopbar />
        <main className="flex-1 overflow-auto p-6">
          <Breadcrumbs items={breadcrumbs} />
          {children}
        </main>
      </div>
    </div>
  );
}
