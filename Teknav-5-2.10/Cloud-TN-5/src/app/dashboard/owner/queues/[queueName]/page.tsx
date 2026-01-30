'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, RefreshCw, Eye, Trash2, RotateCcw, Pause, Play, Filter } from 'lucide-react';
import { getQueueJobs, retryJob, cancelJob, getQueueStats, pauseQueue, resumeQueue } from './_actions/queue-actions';

/**
 * Queue Detail Page (Jobs List)
 * M11 - Queue Platform: "Owner Queue Observatory UI"
 */

type QueueJob = {
  id: string;
  aiJobId: number;
  jobType: string;
  status: 'WAITING' | 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'MOVED_TO_DLQ';
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  errorMessage?: string;
  traceId: string;
  entity: {
    type: string;
    id: string | number;
  };
  actorId?: number;
  tenantId?: number;
  workspaceId?: number;
};

type QueueStats = {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
};

export default function QueueDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { queueName } = params;
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [stats, setStats] = useState<QueueStats | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [jobTypeFilter, setJobTypeFilter] = useState<string>('ALL');
  const [searchFilter, setSearchFilter] = useState<string>('');

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);

  // Selected jobs
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (queueName) {
      loadJobs();
      loadStats();
    }
  }, [queueName, page, pageSize, statusFilter, jobTypeFilter, searchFilter]);

  const loadJobs = async () => {
    if (!queueName) return;

    setLoading(true);
    try {
      const data = await getQueueJobs(queueName, {
        page,
        pageSize,
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
        jobType: jobTypeFilter !== 'ALL' ? jobTypeFilter : undefined,
        search: searchFilter || undefined,
      });

      setJobs(data.data);
      setTotal(data.total || 0);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    if (!queueName) return;

    try {
      const data = await getQueueStats(queueName);
      setStats(data);
    } catch (error: any) {
      console.error('Failed to load stats', error);
    }
  };

  const handleRetry = async (aiJobId: number) => {
    if (!confirm('Retry this job? This will create a new job with the same payload.')) {
      return;
    }

    try {
      await retryJob(queueName!, aiJobId);
      toast({ title: 'Job retried', description: 'Job has been added back to the queue' });
      await loadJobs();
      await loadStats();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    }
  };

  const handleCancel = async (aiJobId: number) => {
    if (!confirm('Cancel this job? This cannot be undone.')) {
      return;
    }

    try {
      await cancelJob(queueName!, aiJobId);
      toast({ title: 'Job cancelled', description: 'Job has been cancelled' });
      await loadJobs();
      await loadStats();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    }
  };

  const handleBulkRetry = async () => {
    if (selectedJobs.size === 0) return;

    if (!confirm(`Retry ${selectedJobs.size} selected jobs?`)) {
      return;
    }

    try {
      for (const jobId of selectedJobs) {
        const job = jobs.find(j => j.id === jobId);
        if (job) {
          await retryJob(queueName!, job.aiJobId);
        }
      }

      toast({ title: 'Jobs retried', description: `${selectedJobs.size} jobs have been retried` });
      setSelectedJobs(new Set());
      await loadJobs();
      await loadStats();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    }
  };

  const handleBulkCancel = async () => {
    if (selectedJobs.size === 0) return;

    if (!confirm(`Cancel ${selectedJobs.size} selected jobs? This cannot be undone.`)) {
      return;
    }

    try {
      for (const jobId of selectedJobs) {
        const job = jobs.find(j => j.id === jobId);
        if (job) {
          await cancelJob(queueName!, job.aiJobId);
        }
      }

      toast({ title: 'Jobs cancelled', description: `${selectedJobs.size} jobs have been cancelled` });
      setSelectedJobs(new Set());
      await loadJobs();
      await loadStats();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    }
  };

  const handlePauseQueue = async () => {
    try {
      await pauseQueue(queueName!);
      toast({ title: 'Queue paused', description: `${queueName} is now paused` });
      await loadStats();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    }
  };

  const handleResumeQueue = async () => {
    try {
      await resumeQueue(queueName!);
      toast({ title: 'Queue resumed', description: `${queueName} is now active` });
      await loadStats();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    }
  };

  const toggleJobSelection = (jobId: string) => {
    const newSelected = new Set(selectedJobs);
    if (newSelected.has(jobId)) {
      newSelected.delete(jobId);
    } else {
      newSelected.add(jobId);
    }
    setSelectedJobs(newSelected);
  };

  const getJobStatusBadge = (status: string) => {
    switch (status) {
      case 'WAITING':
        return <Badge variant="secondary">Waiting</Badge>;
      case 'ACTIVE':
        return <Badge variant="default">Active</Badge>;
      case 'COMPLETED':
        return <Badge variant="default" className="bg-green-500">Completed</Badge>;
      case 'FAILED':
        return <Badge variant="destructive">Failed</Badge>;
      case 'CANCELLED':
        return <Badge variant="outline">Cancelled</Badge>;
      case 'MOVED_TO_DLQ':
        return <Badge variant="destructive" className="bg-red-600">DLQ</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const filteredJobs = jobs.filter(job => {
    if (statusFilter !== 'ALL' && job.status !== statusFilter) return false;
    if (jobTypeFilter !== 'ALL' && job.jobType !== jobTypeFilter) return false;
    if (searchFilter && !job.traceId.includes(searchFilter) && !job.entity.id.toString().includes(searchFilter)) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push('/dashboard/owner/queues')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{queueName?.replace('teknav:queue:', '')}</h1>
            <p className="text-muted-foreground text-sm">Jobs list and management</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {stats?.paused ? (
            <Button variant="default" size="sm" onClick={handleResumeQueue}>
              <Play className="h-4 w-4 mr-2" />
              Resume Queue
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={handlePauseQueue}>
              <Pause className="h-4 w-4 mr-2" />
              Pause Queue
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={() => { loadJobs(); loadStats(); }} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push(`/dashboard/owner/queues/${queueName}/dlq`)}>
            View DLQ
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push(`/dashboard/owner/queues/${queueName}/quarantine`)}>
            View Quarantine
          </Button>
        </div>
      </div>

      {/* Queue Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{stats.waiting}</div>
              <p className="text-xs text-muted-foreground">Waiting</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-blue-600">{stats.active}</div>
              <p className="text-xs text-muted-foreground">Active</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
              <p className="text-xs text-muted-foreground">Completed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
              <p className="text-xs text-muted-foreground">Failed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-gray-600">{stats.delayed}</div>
              <p className="text-xs text-muted-foreground">Delayed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-purple-600">{stats.paused ? 'Paused' : 'Active'}</div>
              <p className="text-xs text-muted-foreground">Status</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium mb-2">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Status</SelectItem>
                  <SelectItem value="WAITING">Waiting</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                  <SelectItem value="MOVED_TO_DLQ">In DLQ</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1">
              <label className="text-sm font-medium mb-2">Job Type</label>
              <Select value={jobTypeFilter} onValueChange={setJobTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Types</SelectItem>
                  <SelectItem value="ai.content">AI Content</SelectItem>
                  <SelectItem value="workflow.run">Workflow Run</SelectItem>
                  <SelectItem value="plugin.execute">Plugin Execute</SelectItem>
                  <SelectItem value="analytics.aggregate">Analytics</SelectItem>
                  <SelectItem value="email.send">Email Send</SelectItem>
                  <SelectItem value="notification.dispatch">Notification</SelectItem>
                  <SelectItem value="otp.send">OTP Send</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-[2]">
              <label className="text-sm font-medium mb-2">Search</label>
              <Input
                placeholder="Search by trace ID or entity ID..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Actions */}
      {selectedJobs.size > 0 && (
        <div className="flex items-center gap-2 p-4 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
          <span className="text-sm font-medium">{selectedJobs.size} jobs selected</span>
          <Button size="sm" variant="default" onClick={handleBulkRetry}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Retry Selected
          </Button>
          <Button size="sm" variant="destructive" onClick={handleBulkCancel}>
            <Trash2 className="h-4 w-4 mr-2" />
            Cancel Selected
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedJobs(new Set())}>
            Clear Selection
          </Button>
        </div>
      )}

      {/* Jobs Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading jobs...</div>
          ) : filteredJobs.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">No jobs found matching your filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted">
                  <tr>
                    <th className="w-10 p-4 text-left">
                      <input
                        type="checkbox"
                        checked={selectedJobs.size === filteredJobs.length}
                        onChange={(e) => {
                          const newSelected = e.target.checked
                            ? new Set(filteredJobs.map(j => j.id))
                            : new Set();
                          setSelectedJobs(newSelected);
                        }}
                      />
                    </th>
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Status</th>
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Job Type</th>
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Trace ID</th>
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Entity</th>
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Created</th>
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Duration</th>
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Attempts</th>
                    <th className="p-4 text-right text-xs font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map(job => (
                    <tr key={job.id} className="border-b hover:bg-muted/50 transition-colors">
                      <td className="p-4">
                        <input
                          type="checkbox"
                          checked={selectedJobs.has(job.id)}
                          onChange={() => toggleJobSelection(job.id)}
                        />
                      </td>
                      <td className="p-4">{getJobStatusBadge(job.status)}</td>
                      <td className="p-4 text-sm">{job.jobType.replace(/\./g, ' ')}</td>
                      <td className="p-4 text-sm font-mono">{job.traceId.substring(0, 16)}...</td>
                      <td className="p-4 text-sm">
                        {job.entity.type}:{job.entity.id}
                      </td>
                      <td className="p-4 text-sm">{new Date(job.createdAt).toLocaleString()}</td>
                      <td className="p-4 text-sm">
                        {job.durationMs ? `${(job.durationMs / 1000).toFixed(1)}s` : '-'}
                      </td>
                      <td className="p-4 text-sm">
                        {job.attempts}/{job.maxAttempts}
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => router.push(`/dashboard/owner/queues/${queueName}/jobs/${job.aiJobId}`)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {(job.status === 'FAILED' || job.status === 'CANCELLED') && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRetry(job.aiJobId)}
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          )}
                          {(job.status === 'WAITING' || job.status === 'ACTIVE') && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleCancel(job.aiJobId)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          <div className="flex items-center justify-between p-4 border-t">
            <div className="text-sm text-muted-foreground">
              Showing {Math.min((page - 1) * pageSize + 1, total)} to {Math.min(page * pageSize, total)} of {total} jobs
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Previous
              </Button>
              <div className="text-sm font-medium">Page {page}</div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => p + 1)}
                disabled={page * pageSize >= total}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
