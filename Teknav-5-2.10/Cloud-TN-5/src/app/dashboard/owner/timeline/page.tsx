'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RefreshCw, Search, Filter, CheckCircle, XCircle, Info, AlertTriangle, Activity } from 'lucide-react';
import { getGlobalTimeline } from './_actions/timeline';
import { formatDate, formatDistanceToNow } from 'date-fns';

/**
 * Admin Timeline Page
 *
 * Features:
 * - Global Timeline List
 * - Entity Timeline Detail
 * - Filters (Workspace, Severity, Type, Date)
 * - Tabs: Audit | Workflows | Notifications | Plugins | Billing | Security
 */

type TimelineEvent = {
  id: string;
  at: Date;
  source: 'audit' | 'workflow' | 'notification' | 'plugin' | 'billing' | 'security';
  actorId: number;
  actorEmail?: string;
  actorName?: string;
  action?: string;
  entityType: string;
  entityId: number;
  severity: 'info' | 'warn' | 'error';
  title: string;
  message: string;
  meta?: Record<string, any>;
};

export default function AdminTimelinePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [activeTab, setActiveTab] = useState<'all' | 'audit' | 'workflow' | 'notification' | 'plugin' | 'billing' | 'security'>('all');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [filterSeverity, setFilterSeverity] = useState<string>(searchParams.get('severity') || '');
  const [filterType, setFilterType] = useState<string>(searchParams.get('type') || '');
  const [filterWorkspace, setFilterWorkspace] = useState<string>(searchParams.get('workspaceId') || '');

  // Load Timeline
  useEffect(() => {
    loadTimeline();
  }, [page, filterSeverity, filterType, filterWorkspace]);

  const loadTimeline = async () => {
    setLoading(true);
    try {
      const response = await getGlobalTimeline({
        workspaceId: filterWorkspace ? parseInt(filterWorkspace) : undefined,
        severity: filterSeverity || undefined,
        type: filterType || undefined,
        page,
        pageSize,
      });
      setEvents(response.data);
      setTotal(response.total);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'info':
        return <Badge variant="secondary"><Info className="h-3 w-3 mr-1" />Info</Badge>;
      case 'warn':
        return <Badge variant="outline" className="bg-yellow-100 text-yellow-800"><AlertTriangle className="h-3 w-3 mr-1" />Warning</Badge>;
      case 'error':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Error</Badge>;
      default:
        return <Badge>{severity}</Badge>;
    }
  };

  const getSourceBadge = (source: string) => {
    switch (source) {
      case 'audit':
        return <Badge variant="outline">Audit</Badge>;
      case 'workflow':
        return <Badge variant="outline" className="text-purple-800">Workflow</Badge>;
      case 'notification':
        return <Badge variant="outline" className="text-blue-800">Notification</Badge>;
      default:
        return <Badge>{source}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Unified Timeline</h1>
        <Button
          variant="outline"
          size="icon"
          onClick={loadTimeline}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search event type..."
                value={filterType}
                onChange={(e) => {
                  setFilterType(e.target.value);
                  setPage(1);
                }}
                className="w-[200px]"
              />
            </div>

            <Select value={filterSeverity} onValueChange={setFilterSeverity}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warn">Warning</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>

            <Select value={activeTab} onValueChange={setActiveTab}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="audit">Audit</SelectItem>
                <SelectItem value="workflow">Workflows</SelectItem>
                <SelectItem value="notification">Notifications</SelectItem>
                <SelectItem value="plugin">Plugins</SelectItem>
                <SelectItem value="billing">Billing</SelectItem>
                <SelectItem value="security">Security</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Timeline Table */}
      <Card>
        <CardHeader>
          <CardTitle>Events ({total})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Loading...</div>
          ) : events.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">No events found.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Type/Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>{getSourceBadge(event.source)}</TableCell>
                    <TableCell>{getSeverityBadge(event.severity)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{event.action || event.type || '-'}</Badge>
                    </TableCell>
                    <TableCell>
                      {event.actorId ? `User ${event.actorId}` : 'System'}
                    </TableCell>
                    <TableCell>
                      {event.entityType}:{event.entityId}
                    </TableCell>
                    <TableCell>
                      <div className="font-bold text-sm">{event.title}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-muted-foreground">{event.message}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(event.at, 'PPpp')}
                        <div className="text-xs text-muted-foreground">
                          ({formatDistanceToNow(event.at, { addSuffix: true })})
                        </div>
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
    </div>
  );
}
