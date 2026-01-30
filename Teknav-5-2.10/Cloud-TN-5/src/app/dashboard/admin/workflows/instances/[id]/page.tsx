'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RefreshCw, Play, XCircle, MoreHorizontal, ChevronRight, Info, Loader2 } from 'lucide-react';
import { getInstance, getInstanceSteps } from '../../_actions/workflows';
import { Breadcrumbs } from '@/components/shared/breadcrumbs';
import { formatDate, formatDistanceToNow } from 'date-fns';

/**
 * Admin Workflow Instance Detail Page
 *
 * Features:
 * - Instance Details (Status, Duration, Errors)
 * - Step Timeline
 * - Error Viewer
 * - Retry / Rerun / Cancel Controls
 * - Live Updates (Polling)
 */

type WorkflowInstance = {
  id: number;
  definitionId: number;
  definition: {
    id: number;
    name: string;
  };
  status: 'RUNNING' | 'FAILED' | 'COMPLETED' | 'CANCELLED';
  startedBy: number;
  startedAt: Date;
  finishedAt: Date | null;
  errorMessage: string | null;
  input: string | null;
  output: string | null;
};

type StepExecution = {
  id: string;
  order: number;
  name: string;
  type: string;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  input: string | null;
  output: string | null;
  error: string | null;
  retryCount: number;
  startedAt: Date;
  finishedAt: Date | null;
};

export default function AdminWorkflowsInstanceDetailPage() {
  const params = useParams();
  const instanceId = params.id;
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [instance, setInstance] = useState<WorkflowInstance | null>(null);
  const [steps, setSteps] = useState<StepExecution[]>([]);
  const [stepsLoading, setStepsLoading] = useState(false);

  // Load Instance
  useEffect(() => {
    loadInstance();
  }, [instanceId]);

  // Live Updates (Polling 30s)
  useEffect(() => {
    const interval = setInterval(() => {
      loadInstance();
    }, 30000);

    return () => clearInterval(interval);
  }, [instanceId]);

  const loadInstance = async () => {
    setLoading(true);
    try {
      const data = await getInstance(instanceId);
      setInstance(data);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to load instance', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleRerun = async () => {
    if (!instance) return;
    setLoading(true);
    try {
      await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/admin/workflows/${instance.definitionId}/rerun`, {
        method: 'POST',
        credentials: 'include',
      });
      toast({ title: 'Workflow rerun started' });
      router.push(`/dashboard/admin/workflows/instances?workflowId=${instance.definitionId}`);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to rerun', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!instance || instance.status !== 'RUNNING') {
      return;
    }
    if (!confirm('Are you sure you want to cancel this running workflow?')) {
      return;
    }
    setLoading(true);
    try {
      await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/admin/workflows/instances/${instance.id}/cancel`, {
        method: 'POST',
        credentials: 'include',
      });
      toast({ title: 'Workflow instance cancelled' });
      loadInstance();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to cancel', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleLoadSteps = async () => {
    setStepsLoading(true);
    try {
      const data = await getInstanceSteps(instanceId);
      setSteps(data);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to load steps', description: error.message });
    } finally {
      setStepsLoading(false);
    }
  };

  // Breadcrumbs
  const breadcrumbs = [
    { label: 'Admin', href: '/dashboard/admin' },
    { label: 'Workflows', href: '/dashboard/admin/workflows' },
    { label: 'Instances', href: '/dashboard/admin/workflows/instances' },
    { label: `Instance ${instanceId}`, href: '' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Workflow Instance</h1>
        <Button
          variant="outline"
          size="icon"
          onClick={loadInstance}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <Breadcrumbs items={breadcrumbs} />

      {/* Instance Details Card */}
      {loading && !instance ? (
        <div className="py-8 text-center text-muted-foreground">Loading...</div>
      ) : instance ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Instance Details</CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline">ID: {instance.id}</Badge>
                <Badge variant="outline">Definition ID: {instance.definitionId}</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm font-medium text-muted-foreground">Status</div>
                <div className="text-2xl font-bold">
                  {instance.status === 'RUNNING' && (
                    <Badge variant="default" className="animate-pulse">Running</Badge>
                  )}
                  {instance.status === 'FAILED' && (
                    <Badge variant="destructive">Failed</Badge>
                  )}
                  {instance.status === 'COMPLETED' && (
                    <Badge variant="default">Completed</Badge>
                  )}
                  {instance.status === 'CANCELLED' && (
                    <Badge variant="secondary">Cancelled</Badge>
                  )}
                </div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Duration</div>
                <div className="text-2xl font-bold">
                  {instance.finishedAt ? formatDistanceToNow(instance.startedAt, instance.finishedAt) : '-'}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm font-medium text-muted-foreground">Started At</div>
                <div className="text-lg">
                  {formatDate(instance.startedAt, 'PPpp')}
                  <div className="text-xs text-muted-foreground">
                    ({formatDistanceToNow(instance.startedAt, { addSuffix: true })})
                  </div>
                </div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Finished At</div>
                <div className="text-lg">
                  {instance.finishedAt ? (
                    <>
                      {formatDate(instance.finishedAt, 'PPpp')}
                      <div className="text-xs text-muted-foreground">
                        ({formatDistanceToNow(instance.finishedAt, { addSuffix: true })})
                      </div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </div>
              </div>
            </div>

            {instance.errorMessage && (
              <div className="p-4 bg-destructive/10 border border-destructive/50 rounded-md">
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-destructive" />
                  <div className="font-bold text-destructive">Error</div>
                </div>
                <div className="text-sm text-destructive">
                  {instance.errorMessage}
                </div>
              </div>
            )}

            <div className="border-t pt-4 mt-4">
              <div className="text-sm font-medium mb-2">Input / Output</div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-bold mb-2">Input (JSON)</div>
                  <div className="p-2 bg-muted/10 rounded text-xs font-mono h-24 overflow-auto">
                    {instance.input || '{}'}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-bold mb-2">Output (JSON)</div>
                  <div className="p-2 bg-muted/10 rounded text-xs font-mono h-24 overflow-auto">
                    {instance.output || '{}'}
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => router.push(`/dashboard/admin/workflows/definitions/${instance.definitionId}`)}
              >
                View Definition
              </Button>
              <Button
                variant="default"
                onClick={handleRerun}
                disabled={loading}
              >
                <Play className="h-4 w-4 mr-2" />
                Rerun
              </Button>
              <Button
                variant="destructive"
                onClick={handleCancel}
                disabled={loading || instance.status !== 'RUNNING'}
              >
                <XCircle className="h-4 w-4 mr-2" />
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Steps Timeline Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Step Timeline</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLoadSteps}
              disabled={stepsLoading || !instance}
            >
              {stepsLoading ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <RefreshCw className="h-3 w-3" />}
              {steps.length > 0 ? `Load Steps (${steps.length})` : 'Load Steps'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {steps.length === 0 ? (
            <div className="py-4 text-center text-muted-foreground">No steps loaded yet. Click "Load Steps" to view execution history.</div>
          ) : (
            <div className="relative space-y-0">
              {/* Vertical Line */}
              <div className="absolute left-[19px] top-0 bottom-0 w-[2px] bg-border" />

              {steps.map((step) => (
                <div key={step.id} className="relative pl-10 pb-8">
                  {/* Dot */}
                  <div className="absolute left-[11px] top-2 w-3 h-3 rounded-full bg-background border-2 border-primary flex items-center justify-center">
                    {step.status === 'RUNNING' && (
                      <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    )}
                    {step.status === 'FAILED' && (
                      <div className="w-1.5 h-1.5 rounded-full bg-destructive" />
                    )}
                    {step.status === 'SUCCESS' && (
                      <div className="w-1.5 h-1.5 rounded-full bg-green-600" />
                    )}
                    {step.status === 'FAILED' && (
                      <div className="w-1.5 h-1.5 rounded-full bg-destructive" />
                    )}
                  </div>

                  {/* Step Content */}
                  <div className="border rounded-md p-4 bg-card">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="font-bold text-sm">{step.name}</div>
                          <Badge variant="outline" className="text-xs">{step.type}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Order: {step.order} | ID: {step.id}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {step.status}
                      </Badge>
                    </div>

                    {step.error && (
                      <div className="mt-2 p-2 bg-destructive/10 text-destructive text-xs rounded">
                        <div className="flex items-center gap-2">
                          <Info className="h-3 w-3" />
                          <span>{step.error}</span>
                        </div>
                      </div>
                    )}

                    <div className="mt-2 grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs font-bold mb-2">Input</div>
                        <div className="p-2 bg-muted/10 rounded text-xs font-mono h-24 overflow-auto">
                          {step.input || '{}'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-bold mb-2">Output</div>
                        <div className="p-2 bg-muted/10 rounded text-xs font-mono h-24 overflow-auto">
                          {step.output || '-'}
                        </div>
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground mt-2">
                      Started: {formatDate(step.startedAt, 'PPpp')} | Finished: {step.finishedAt ? formatDate(step.finishedAt, 'PPpp') : '-'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
