'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RefreshCw, Play, MoreHorizontal } from 'lucide-react';
import { runWorkflow } from './_actions/workflows';
import { formatDate, formatDistanceToNow } from 'date-fns';

/**
 * Admin Workflows List Page (Definitions)
 *
 * Features:
 * - List Workflow Definitions
 * - Run button (Triggers workflow)
 * - Status badges (Active/Inactive)
 * - Pagination
 * - Realtime updates (Polling)
 */

type Workflow = {
  id: number;
  name: string;
  description: string;
  status: 'ACTIVE' | 'INACTIVE';
  triggers: any[];
  steps: any[];
  createdAt: Date;
  updatedAt: Date;
};

export default function AdminWorkflowsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [filterStatus, setFilterStatus] = useState<'all' | 'ACTIVE' | 'INACTIVE'>('all');

  // Load Workflows
  useEffect(() => {
    loadWorkflows();
  }, [page, filterStatus]);

  const loadWorkflows = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/admin/workflows/definitions?page=${page}&pageSize=${pageSize}${filterStatus !== 'all' ? `&status=${filterStatus}` : ''}`, {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch workflows');
      }

      const data = await response.json();
      setWorkflows(data.data);
      setTotal(data.total);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleRun = async (id: number, name: string) => {
    try {
      await runWorkflow(id.toString());
      toast({ title: `Workflow "${name}" started` });
      router.push(`/dashboard/admin/workflows/instances?workflowId=${id}`);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to start workflow', description: error.message });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return <Badge variant="default"><Play className="h-3 w-3 mr-1" />Active</Badge>;
      case 'INACTIVE':
        return <Badge variant="secondary">Inactive</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Workflows</h1>
        <Button
          variant="outline"
          size="icon"
          onClick={loadWorkflows}
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
              <div className="flex gap-2">
                <Button
                  variant={filterStatus === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterStatus('all')}
                >
                  All
                </Button>
                <Button
                  variant={filterStatus === 'ACTIVE' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterStatus('ACTIVE')}
                >
                  Active
                </Button>
                <Button
                  variant={filterStatus === 'INACTIVE' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterStatus('INACTIVE')}
                >
                  Inactive
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Workflows Table */}
      <Card>
        <CardHeader>
          <CardTitle>Workflow Definitions ({total})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Loading...</div>
          ) : workflows.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">No workflows found.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Triggers</TableHead>
                  <TableHead>Steps</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workflows.map((workflow) => (
                  <TableRow key={workflow.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-foreground">{workflow.name}</h3>
                        <span className="text-xs text-muted-foreground">ID: {workflow.id}</span>
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(workflow.status)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {workflow.triggers.map((trigger) => (
                          <Badge key={trigger.id} variant="outline" className="text-xs">
                            {trigger.type}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs text-muted-foreground">
                        {workflow.steps.length} steps
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(workflow.createdAt, 'PPpp')}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(`/dashboard/admin/workflows/definitions/${workflow.id}`)}
                          title="Edit Definition"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => handleRun(workflow.id, workflow.name)}
                          title="Run Workflow"
                          disabled={workflow.status !== 'ACTIVE'}
                        >
                          <Play className="h-4 w-4" />
                          Run
                        </Button>
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
