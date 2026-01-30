'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RefreshCw, Play, Circle, XCircle, AlertTriangle, MoreHorizontal } from 'lucide-react';
import { getInstances, cancelInstance } from './_actions/workflows';
import { formatDate, formatDistanceToNow } from 'date-fns';

/**
 * Admin Workflows Instances List Page
 *
 * Features:
 * - List Workflow Instances
 * - Filters (Status, Workflow ID, Sort)
 * - Status Badges (Running, Failed, Completed, Cancelled)
 * - Actions (Rerun, Cancel, View)
 * - Live Updates (Polling 30s)
 */

type WorkflowInstance = {
  id: number;
  definitionId: number;
  definition: any;
  status: 'RUNNING' | 'FAILED' | 'COMPLETED' | 'CANCELLED';
  startedBy: number;
  startedAt: Date;
  finishedAt: Date | null;
  errorMessage: string | null;
  input: string | null;
  triggerContext: string | null;
  output: string | null;
};

export default function AdminWorkflowsInstancesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [filterStatus, setFilterStatus] = useState<string>(searchParams.get('status') || '');
  const [filterWorkflowId, setFilterWorkflowId] = useState<number | undefined>(searchParams.get('workflowId') ? parseInt(searchParams.get('workflowId')!) : undefined);
  const [filterSort, setFilterSort] = useState<string>(searchParams.get('sort') || 'createdAt');
  const [filterOrder, setFilterOrder] = useState<'asc' | 'desc'>(searchParams.get('order') as 'asc' | 'desc' || 'desc');

  // Load Instances
  useEffect(() => {
    loadInstances();
  }, [page, filterStatus, filterWorkflowId, filterSort, filterOrder]);

  // Realtime Polling (30s)
  useEffect(() => {
    const interval = setInterval(() => {
      loadInstances(); // Poll for updates
    }, 30000); // 30s

    return () => clearInterval(interval);
  }, [filterWorkflowId, filterStatus]);

  const loadInstances = async () => {
    setLoading(true);
    try {
      const response = await getInstances({
        status: filterStatus || undefined,
        workflowId: filterWorkflowId,
        page,
        pageSize,
        sort: filterSort,
        order: filterOrder,
      });
      setInstances(response.data);
      setTotal(response.total);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (instanceId: number) => {
    if (!confirm('Are you sure you want to cancel this workflow instance?')) {
      return;
    }
    try {
      await cancelInstance(instanceId.toString());
      toast({ title: 'Instance cancelled' });
      loadInstances();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to cancel', description: error.message });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'RUNNING':
        return <Badge variant="default" className="animate-pulse"><Circle className="h-3 w-3 mr-1" />Running</Badge>;
      case 'FAILED':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Failed</Badge>;
      case 'COMPLETED':
        return <Badge variant="default"><Circle className="h-3 w-3 mr-1" />Completed</Badge>;
      case 'CANCELLED':
        return <Badge variant="secondary">Cancelled</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Workflow Instances</h1>
        <Button
          variant="outline"
          size="icon"
          onClick={loadInstances}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Status:</span>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All</SelectItem>
                  <SelectItem value="RUNNING">Running</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Sort By:</span>
              <Select value={filterSort} onValueChange={setFilterSort}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Created" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="createdAt">Created</SelectItem>
                  <SelectItem value="updatedAt">Updated</SelectItem>
                  <SelectItem value="duration">Duration</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Instances Table */}
      <Card>
        <CardHeader>
          <CardTitle>Instances ({total})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Loading...</div>
          ) : instances.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">No workflow instances found.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Definition</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started At</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Finished At</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {instances.map((instance) => (
                  <TableRow key={instance.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="font-bold">{instance.definition.name}</div>
                        <div className="text-xs text-muted-foreground">ID: {instance.definitionId}</div>
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(instance.status)}</TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {formatDate(instance.startedAt, 'PPpp')}
                        <div className="text-xs text-muted-foreground">
                          {formatDistanceToNow(instance.startedAt, { addSuffix: true })}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {instance.finishedAt ? (
                        <div className="text-sm">
                          {formatDate(instance.finishedAt, 'PPpp')}
                          <div className="text-xs text-muted-foreground">
                            {formatDistanceToNow(instance.finishedAt, { addSuffix: true })}
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">-</div>
                      )}
                    </TableCell>
                    <TableCell>
                      {instance.status === 'FAILED' && (
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-destructive" />
                          <span className="text-xs text-destructive">
                            {instance.errorMessage || 'Unknown error'}
                          </span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(`/dashboard/admin/workflows/instances/${instance.id}`)}
                          title="View Steps"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                        {instance.status === 'RUNNING' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleCancel(instance.id)}
                            title="Cancel Instance"
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        )}
                        {instance.status === 'FAILED' && (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => router.push(`/dashboard/admin/workflows/definitions/${instance.definitionId}`)}
                            title="Rerun Workflow"
                          >
                            <Play className="h-4 w-4" />
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
    </div>
  );
}
