'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, CheckCircle, Mail, Search, Filter } from 'lucide-react';
import { formatDate, formatDistanceToNow } from 'date-fns';

/**
 * User Notifications Page
 *
 * Features:
 * - List Notifications
 * - Mark as Read (Batch)
 * - Filters (Status, Type, Search)
 */

type Notification = {
  id: number;
  type: 'info' | 'success' | 'error' | 'warning';
  title: string;
  message: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'READ';
  readAt: Date | null;
  createdAt: Date;
  metadata?: Record<string, any>;
};

export default function UserNotificationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [filterStatus, setFilterStatus] = useState<string>(searchParams.get('status') || '');
  const [filterType, setFilterType] = useState<string>(searchParams.get('type') || '');
  const [filterQ, setFilterQ] = useState<string>(searchParams.get('q') || '');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Load Notifications
  useEffect(() => {
    loadNotifications();
  }, [page, filterStatus, filterType, filterQ]);

  const loadNotifications = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/me/notifications?page=${page}&pageSize=${pageSize}${filterStatus ? `&status=${filterStatus}` : ''}${filterType ? `&type=${filterType}` : ''}${filterQ ? `&q=${filterQ}` : ''}`, {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch notifications');
      }

      const data = await response.json();
      setNotifications(data.data);
      setTotal(data.total);
      setSelectedIds([]);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleMarkRead = async () => {
    if (selectedIds.length === 0) return;
    try {
      const response = await fetch(`/api/me/notifications/read`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds }),
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to mark read');
      }

      toast({ title: 'Marked as read' });
      loadNotifications();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to mark read', description: error.message });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <Badge variant="secondary">Pending</Badge>;
      case 'SENT':
        return <Badge variant="default"><CheckCircle className="h-3 w-3 mr-1" />Sent</Badge>;
      case 'FAILED':
        return <Badge variant="destructive">Failed</Badge>;
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
        <h1 className="text-3xl font-bold">My Notifications</h1>
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

            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Actions Bar */}
      <div className="flex items-center justify-end gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Select:</span>
          <input
            type="checkbox"
            checked={selectedIds.length > 0 && selectedIds.length === notifications.length}
            onChange={(checked) => {
              if (checked) setSelectedIds(notifications.map(n => n.id));
              else setSelectedIds([]);
            }}
          />
        </div>
        <Button
          variant="default"
          onClick={handleMarkRead}
          disabled={selectedIds.length === 0}
        >
          <CheckCircle className="h-4 w-4 mr-2" />
          Mark as Read
        </Button>
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
                    <input
                      type="checkbox"
                      checked={selectedIds.length > 0 && selectedIds.length === notifications.length}
                      onChange={(checked) => {
                        if (checked) setSelectedIds(notifications.map(n => n.id));
                        else setSelectedIds([]);
                      }}
                    />
                  </TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {notifications.map((notification) => (
                  <TableRow
                    key={notification.id}
                    className={selectedIds.includes(notification.id) ? 'bg-muted/50' : ''}
                  >
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(notification.id)}
                        onChange={(checked) => {
                          if (checked) setSelectedIds([...selectedIds, notification.id]);
                          else setSelectedIds(selectedIds.filter(id => id !== notification.id));
                        }}
                      />
                    </TableCell>
                    <TableCell>{getStatusBadge(notification.status)}</TableCell>
                    <TableCell>{getTypeBadge(notification.type)}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="font-bold text-foreground">{notification.title}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-muted-foreground line-clamp-1">{notification.message}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(notification.createdAt, 'PPpp')}
                        <div className="text-xs text-muted-foreground">
                          {formatDistanceToNow(notification.createdAt, { addSuffix: true })}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => router.push(`/dashboard/owner/timeline?entityType=Notification&entityId=${notification.id}`)}
                        title="View Timeline"
                      >
                        <Mail className="h-4 w-4" />
                      </Button>
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
    </div>
  );
}
