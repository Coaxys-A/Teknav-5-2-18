'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LogOut, User, Building2 } from 'lucide-react';
import { getMe } from '@/app/dashboard/writer/_actions/auth';
import { formatDate } from 'date-fns';

/**
 * Writer Settings Page
 *
 * Shows user profile basics and workspace membership info.
 * Includes "Sign out" button.
 */

export default function WriterSettingsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<any>(null);

  // Load User
  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    setLoading(true);
    try {
      const me = await getMe();
      setUser(me);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to load user', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      toast({ title: 'Signed out' });
      router.push('/auth/login');
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to sign out', description: error.message });
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Settings</h1>

      {/* Profile Card */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={user?.email || ''} disabled />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={user?.name || ''} disabled />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Created At</Label>
            <Input value={user?.createdAt ? formatDate(user.createdAt, 'PPpp') : ''} disabled />
          </div>
        </CardContent>
      </Card>

      {/* Workspace Card */}
      <Card>
        <CardHeader>
          <CardTitle>Workspace Memberships</CardTitle>
        </CardHeader>
        <CardContent>
          {user?.memberships && user.memberships.length > 0 ? (
            <div className="space-y-4">
              {user.memberships.map((membership) => (
                <div key={membership.id} className="flex items-center justify-between border rounded-md p-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-primary" />
                      <span className="text-sm font-bold">Workspace ID: {membership.workspaceId}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Role: {membership.role}
                    </div>
                  </div>
                  {/* Actions */}
                  {/* TODO: Switch Workspace button could go here */}
                </div>
              ))}
            </div>
          ) : (
            <div className="py-4 text-center text-muted-foreground">No workspace memberships found.</div>
          )}
        </CardContent>
      </Card>

      {/* Logout Card */}
      <Card>
        <CardContent className="pt-6">
          <Button
            variant="outline"
            className="w-full"
            onClick={handleLogout}
            disabled={loading}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
