'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, RefreshCw, RotateCcw, Trash2, Eye, Filter, X } from 'lucide-react';
import { getDlqJobs, replayJob, bulkReplayJobs, deleteDlqJob, clearDlq, getDlqStats } from '../../_actions/dlq-actions';

/**
 * Queue DLQ Page
 * M11 - Queue Platform: "DLQ + Replay UI"
 */

type DlqJob = {
  id: string;
  aiJobId: number;
  originalJobId: string;
  originalQueue: string;
  attemptsMade: number;
  failedAt: string;
  error: {
    name: string;
    message: string;
    code?: string;
    stack?: string;
  };
};

export default function DlqPage() {
  const router = useRouter();
  const params = useParams();
  const { queueName } = params;
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<DlqJob[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Filters
  const [errorTypeFilter, setErrorTypeFilter] = useState<string>('ALL');
  const [searchFilter, setSearchFilter] = useState<string>('');

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);

  // Selected jobs
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (queueName) {
      loadDlq();
      loadStats();
    }
  }, [queueName, page, pageSize, errorTypeFilter, searchFilter]);

  const loadDlq = async () => {
    if (!queueName) return;

    setLoading(true);
    try {
      const data = await getDlqJobs(queueName, {
        page,
        pageSize,
        errorType: errorTypeFilter !== 'ALL' ? errorTypeFilter : undefined,
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
      const data = await getDlqStats(queueName);
      setStats(data);
    } catch (error: any) {
      console.error('Failed to load DLQ stats', error);
    }
  };

  const handleReplay = async (jobId: string) => {
    if (!confirm('Replay this job? This will create a new job with the same payload.')) {
      return;
    }

    try {
      await replayJob(queueName!, jobId);
      toast({ title: 'Job replayed', description: 'Job has been added back to the main queue' });
      await loadDlq();
      await loadStats();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    }
  };

  const handleBulkReplay = async () => {
    if (selectedJobs.size === 0) return;

    if (!confirm(`Replay ${selectedJobs.size} selected jobs? This will create new jobs with the same payloads.`)) {
      return;
    }

    try {
      await bulkReplayJobs(queueName!, Array.from(selectedJobs));
      toast({ title: 'Jobs replayed', description: `${selectedJobs.size} jobs have been added back to the queue` });
      setSelectedJobs(new Set());
      await loadDlq();
      await loadStats();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    }
  };

  const handleDelete = async (jobId: string) => {
    if (!confirm('Delete this DLQ job? This cannot be undone.')) {
      return;
    }

    try {
      await deleteDlqJob(queueName!, jobId);
      toast({ title: 'Job deleted', description: 'Job has been removed from DLQ' });
      await loadDlq();
      await loadStats();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    }
  };

  const handleClearDlq = async () => {
    if (!confirm(`Clear ALL jobs from DLQ for queue ${queueName}? This cannot be undone.`)) {
      return;
    }

    try {
      await clearDlq(queueName!);
      toast({ title: 'DLQ cleared', description: `All jobs have been removed from DLQ` });
      await loadDlq();
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

  const filteredJobs = jobs.filter(job => {
    if (errorTypeFilter !== 'ALL' && job.error.name !== errorTypeFilter) return false;
    if (searchFilter && !job.id.includes(searchFilter) && !job.payload?.idempotencyKey?.includes(searchFilter)) return false;
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
            <h1 className="text-3xl font-bold">Dead-Letter Queue (DLQ)</h1>
            <p className="text-muted-foreground text-sm">{queueName?.replace('teknav:queue:', '')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={autoRefresh ? 'default' : 'secondary'}>
            {autoRefresh ? 'Auto-Refresh: ON' : 'Auto-Refresh: OFF'}
          </Badge>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push(`/dashboard/owner/queues/${queueName}`)}>
            View Queue
          </Button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-red-600">{stats.total}</div>
              <p className="text-xs text-muted-foreground">Total DLQ Jobs</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-orange-600">
                {stats.oldestJobAge ? `${Math.round(stats.oldestJobAge / 3600000)}h` : '-'}
              </div>
              <p className="text-xs text-muted-foreground">Oldest Job Age</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-purple-600">{Object.values(stats.byReason || {}).reduce((sum, c) => sum + c, 0)}</div>
              <p className="text-xs text-muted-foreground">Total Errors</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium mb-2">Error Type</label>
              <Select value={errorTypeFilter} onValueChange={setErrorTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by error type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Error Types</SelectItem>
                  <SelectItem value="ValidationError">Validation</SelectItem>
                  <SelectItem value="TransientError">Transient</SelectItem>
                  <SelectItem value="RateLimitError">Rate Limit</SelectItem>
                  <SelectItem value="AuthError">Auth</SelectItem>
                  <SelectItem value="PoisonError">Poison</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-[2]">
              <label className="text-sm font-medium mb-2">Search</label>
              <Input
                placeholder="Search by job ID or error message..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Actions */}
      {selectedJobs.size > 0 && (
        <Alert>
          <AlertDescription className="flex items-center justify-between">
            <span>{selectedJobs.size} jobs selected</span>
            <div className="flex gap-2">
              <Button size="sm" variant="default" onClick={handleBulkReplay}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Replay Selected
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedJobs(new Set())}>
                Clear Selection
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Jobs List */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading DLQ jobs...</div>
          ) : filteredJobs.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">No DLQ jobs found.</div>
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
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Error Type</th>
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Attempts</th>
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Failed At</th>
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Error Message</th>
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
                      <td className="p-4 text-sm">
                        <Badge variant="outline">{job.error.name}</Badge>
                      </td>
                      <td className="p-4 text-sm">{job.attemptsMade}</td>
                      <td className="p-4 text-sm">{new Date(job.failedAt).toLocaleString()}</td>
                      <td className="p-4 text-sm max-w-[300px] truncate">{job.error.message}</td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleReplay(job.id)}
                          >
                            <RotateCcw className="h-4 w-4 text-blue-500" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(job.id)}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
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

      {/* Clear All */}
      <div className="flex justify-end">
        <Button
          variant="destructive"
          onClick={handleClearDlq}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Clear DLQ
        </Button>
      </div>
    </div>
  );
}
