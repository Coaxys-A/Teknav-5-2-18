'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Bell, XCircle, CheckCircle, AlertTriangle, Trash2 } from 'lucide-react';
import { formatDate, formatDistanceToNow } from 'date-fns';
import { getUserNotifications, markNotificationsRead } from '@/app/dashboard/notifications/_actions/notifications';

/**
 * User Notifications Bell Component
 *
 * Features:
 * - Unread Count Badge
 * - Dropdown List (Latest 10)
 * - Mark as Read
 * - "View All" link
 * - Live Updates (Polling for MVP)
 */

type Notification = {
  id: number;
  type: 'info' | 'success' | 'error' | 'warning';
  title: string;
  message: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'READ';
  readAt: Date | null;
  createdAt: Date;
  link?: string;
  metadata?: Record<string, any>;
};

export function UserNotificationsBell() {
  const router = useRouter();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  // Fetch Notifications (Polling every 30s)
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchNotifications = async () => {
    try {
      const response = await getUserNotifications({ status: 'PENDING', pageSize: 10 });
      setNotifications(response.data);
      setUnreadCount(response.total);
    } catch (error: any) {
      console.error('Failed to fetch notifications', error);
    }
  };

  const handleMarkRead = async (id: number) => {
    try {
      await markNotificationsRead([id]);
      setNotifications(prev => prev.filter(n => n.id !== id));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to mark read', description: error.message });
    }
  };

  const handleMarkAllRead = async () => {
    const ids = notifications.map(n => n.id);
    try {
      await markNotificationsRead(ids);
      setNotifications([]);
      setUnreadCount(0);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to mark all read', description: error.message });
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'success': return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'error': return <XCircle className="h-4 w-4 text-destructive" />;
      case 'warning': return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
      case 'info': default: return <Bell className="h-4 w-4 text-primary" />;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500 text-xs font-bold text-white items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[400px] max-h-[500px]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Notifications</DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push('/dashboard/notifications')}
            >
              View All
            </Button>
          </div>
        </DialogHeader>
        <div className="space-y-4 max-h-[400px] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="text-center text-muted-foreground py-4">No new notifications.</div>
          ) : (
            <div className="space-y-3">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className="flex items-start gap-3 p-3 hover:bg-muted/50 rounded-md transition-colors cursor-pointer group"
                  onClick={() => {
                    handleMarkRead(notification.id);
                    if (notifications.length === 1) setIsOpen(false);
                  }}
                >
                  <div className="mt-1">{getTypeIcon(notification.type)}</div>
                  <div className="flex-1">
                    <div className="font-bold text-sm">{notification.title}</div>
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-1">{notification.message}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatDate(notification.createdAt, 'PPpp')} ({formatDistanceToNow(notification.createdAt, { addSuffix: true })})
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="pt-4 border-t flex justify-between items-center">
            <span className="text-sm text-muted-foreground">
              {unreadCount} unread
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkAllRead}
              disabled={unreadCount === 0}
            >
              Mark All Read
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
