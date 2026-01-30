'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { RefreshCw, CheckCircle, XCircle, Mail, Search, Filter, Trash2, RotateCw, Eye } from 'lucide-react';
import { getNotifications, markNotificationsRead, retryNotification, purgeNotifications, replayDlqJob } from './_actions/notifications';
import { formatDate, formatDistanceToNow } from 'date-fns';

/**
 * Admin Notifications Page
 *
 * Features:
 * - List Notifications (Table)
 * - Filters (Status, Channel, Type, Search)
 * - Actions (Retry, Mark Read, Purge)
 * - DLQ Viewer + Replay
 */

type Notification = {
  id: number;
  recipientUserId: number;
  type: 'info' | 'success' | 'error' | 'warning';
  channel: 'email' | 'sms' | 'push' | 'in_app';
  title: string;
  message: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'READ';
  readAt: Date | null;
  createdAt: Date;
  metadata: Record<string, any>;
};

export default function AdminNotificationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [filterStatus, setFilterStatus] = useState<string>(searchParams.get('status') || '');
  const [filterChannel, setFilterChannel] = useState<string>(searchParams.get('channel') || '');
  const [filterType, setFilterType] = useState<string>(searchParams.get('type') || '');
  const [filterQ, setFilterQ] = useState<string>(searchParams.get('q') || '');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isPurgeOpen, setIsPurgeOpen] = useState(false);
  const [purgeDays, setPurgeDays] = useState(30);

  // Load Notifications
  useEffect(() => {
    loadNotifications();
  }, [page, filterStatus, filterChannel, filterType, filterQ]);

  const loadNotifications = async () => {
    setLoading(true);
    try {
      const response = await getNotifications({
        status: filterStatus || undefined,
        channel: filterChannel || undefined,
        type: filterType || undefined,
        q: filterQ || '',
        page,
        pageSize,
      });
      setNotifications(response.data);
      setTotal(response.total);
      setSelectedIds([]);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  // Mark Read
  const handleMarkRead = async () => {
    if (selectedIds.length === 0) return;
    try {
      await markNotificationsRead(selectedIds);
      toast({ title: 'Marked as read' });
      loadNotifications();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to mark read', description: error.message });
    }
  };

  // Retry
  const handleRetry = async (id: number, title: string) => {
    if (!confirm(`Retry notification "${title}"?`)) return;
    try {
      await retryNotification(id.toString());
      toast({ title: 'Retrying notification' });
      loadNotifications();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to retry', description: error.message });
    }
  };

  // Purge
  const handlePurge = async () => {
    try {
      await purgeNotifications(purgeDays, filterStatus || undefined);
      toast({ title: `Purged notifications older than ${purgeDays} days` });
      loadNotifications();
      setIsPurgeOpen(false);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to purge', description: error.message });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <Badge variant="secondary">Pending</Badge>;
      case 'SENT':
        return <Badge variant="default"><CheckCircle className="h-3 w-3 mr-1" />Sent</Badge>;
      case 'FAILED':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Failed</Badge>;
      case 'READ':
        return <Badge variant="outline">Read</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'success': return <Badge variant="default" className="bg-green-100 text-green-800">Success</Badge>;
      case 'error': return <Badge variant="destructive">Error</Badge>;
      case 'warning': return <Badge className="bg-yellow-100 text-yellow-800">Warning</Badge>;
      case 'info': default: return <Badge variant="secondary">Info</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Notifications</h1>
        <Button
          variant="outline"
          size="icon"
          onClick={loadNotifications}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Search */}
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search notifications..."
                value={filterQ}
                onChange={(e) => {
                  setFilterQ(e.target.value);
                  setPage(1);
                }}
                className="w-full"
              />
            </div>

            {/* Status */}
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="SENT">Sent</SelectItem>
                <SelectItem value="FAILED">Failed</SelectItem>
                <SelectItem value="READ">Read</SelectItem>
              </SelectContent>
            </Select>

            {/* Channel */}
            <Select value={filterChannel} onValueChange={setFilterChannel}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Channel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
                <SelectItem value="push">Push</SelectItem>
                <SelectItem value="in_app">In-App</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Actions Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={selectedIds.length > 0 && selectedIds.length === notifications.length}
            onCheckedChange={(checked) => {
              if (checked) setSelectedIds(notifications.map(n => n.id));
              else setSelectedIds([]);
            }}
          />
          <span className="text-sm text-muted-foreground">Select All</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkRead}
            disabled={selectedIds.length === 0}
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            Mark Read
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsPurgeOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Purge
          </Button>
        </div>
      </div>

      {/* Notifications Table */}
      <Card>
        <CardHeader>
          <CardTitle>Notifications ({total})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Loading...</div>
          ) : notifications.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">No notifications found.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={selectedIds.length > 0 && selectedIds.length === notifications.length}
                      onCheckedChange={(checked) => {
                        if (checked) setSelectedIds(notifications.map(n => n.id));
                        else setSelectedIds([]);
                      }}
                    />
                  </TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {notifications.map((notification) => (
                  <TableRow key={notification.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.includes(notification.id)}
                        onCheckedChange={(checked) => {
                          if (checked) setSelectedIds([...selectedIds, notification.id]);
                          else setSelectedIds(selectedIds.filter(id => id !== notification.id));
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-medium">User {notification.recipientUserId}</span>
                    </TableCell>
                    <TableCell>{getTypeBadge(notification.type)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{notification.channel}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="font-bold text-sm">{notification.title}</div>
                        <div className="text-xs text-muted-foreground line-clamp-1">{notification.message}</div>
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(notification.status)}</TableCell>
                    <TableCell>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(notification.createdAt, 'PPpp')}
                        <div className="text-xs text-muted-foreground">
                          {formatDistanceToNow(notification.createdAt, { addSuffix: true })}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          title="View Details"
                          onClick={() => router.push(`/dashboard/owner/notifications/${notification.id}`)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {notification.status === 'FAILED' && (
                          <Button
                            variant="outline"
                            size="icon"
                            title="Retry"
                            onClick={() => handleRetry(notification.id, notification.title)}
                          >
                            <RotateCw className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => p + 1)}
            disabled={page * pageSize >= total}
          >
            Next
          </Button>
        </div>
      )}

      {/* Purge Dialog */}
      <Dialog open={isPurgeOpen} onOpenChange={setIsPurgeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Purge Notifications</DialogTitle>
            <DialogDescription>
              This will permanently delete notifications older than {purgeDays} days.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="days">Days</Label>
              <Input
                id="days"
                type="number"
                min={1}
                max={365}
                value={purgeDays}
                onChange={(e) => setPurgeDays(parseInt(e.target.value))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPurgeOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handlePurge}>
              Purge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
