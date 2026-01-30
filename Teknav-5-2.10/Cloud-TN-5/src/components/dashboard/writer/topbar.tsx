'use client';

import { Button } from '@/components/ui/button';
import { User, LogOut, Globe } from 'lucide-react';
import { useRouter } from 'next/navigation';

/**
 * Writer Topbar
 */

export function WriterTopbar() {
  const router = useRouter();

  const handleLogout = async () => {
    // Call server action to logout
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/auth/login');
  };

  return (
    <div className="flex items-center justify-between border-b bg-card p-4">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
          W
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground">
            Workspace: TEKNAV DEV
          </div>
          <div className="text-xs text-muted-foreground">
            ali@teknav.ir
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/')}
        >
          <Globe className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign Out
        </Button>
      </div>
    </div>
  );
}
