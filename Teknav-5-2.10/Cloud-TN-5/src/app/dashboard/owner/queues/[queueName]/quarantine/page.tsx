'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, RefreshCw, Play, Trash2, Filter, X, ShieldAlert } from 'lucide-react';
import { getQuarantinedJobs, deleteQuarantinedJob, promoteToDlq, bulkDeleteQuarantine, clearQuarantine, getQuarantineStats } from '../../_actions/quarantine-actions';

/**
 * Quarantine Lane Page
 * M11 - Queue Platform: "Quarantine Lane (Innovation)"
 */

type QuarantinedJob = {
  jobType: string;
  jobId: string;
  reason: string;
  errorMessage: string;
  failedAt: string;
  attempts: number;
};

export default function QuarantinePage() {
  const router = useRouter();
  const params = useParams();
  const { queueName } = params;
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<QuarantinedJob[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Filters
  const [reasonFilter, setReasonFilter] = useState<string>('ALL');
  const [searchFilter, setSearchFilter] = useState<string>('');

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);

  // Selected jobs
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (queueName) {
      loadQuarantine();
      loadStats();
    }
  }, [queueName, page, pageSize, reasonFilter, searchFilter]);

  const loadQuarantine = async () => {
    if (!queueName) return;

    setLoading(true);
    try {
      const data = await getQuarantinedJobs(queueName, {
        page,
        pageSize,
        reason: reasonFilter !== 'ALL' ? reasonFilter : undefined,
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
      const data = await getQuarantineStats(queueName);
      setStats(data);
    } catch (error: any) {
      console.error('Failed to load quarantine stats', error);
    }
  };

  const handlePromote = async (jobId: string) => {
    if (!confirm('Promote this job to DLQ? This will move it to the dead-letter queue.')) {
      return;
    }

    try {
      await promoteToDlq(queueName!, jobId);
      toast({ title: 'Job promoted', description: 'Job has been moved to DLQ' });
      await loadQuarantine();
      await loadStats();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    }
  };

  const handleDelete = async (jobId: string) => {
    if (!confirm('Delete this quarantined job? This cannot be undone.')) {
      return;
    }

    try {
      await deleteQuarantinedJob(queueName!, jobId);
      toast({ title: 'Job deleted', description: 'Job has been removed from quarantine' });
      await loadQuarantine();
      await loadStats();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    }
  };

  const handleBulkDelete = async () => {
    if (selectedJobs.size === 0) return;

    if (!confirm(`Delete ${selectedJobs.size} quarantined jobs? This cannot be undone.`)) {
      return;
    }

    try {
      await bulkDeleteQuarantine(queueName!, Array.from(selectedJobs));
      toast({ title: 'Jobs deleted', description: `${selectedJobs.size} jobs have been removed from quarantine` });
      setSelectedJobs(new Set());
      await loadQuarantine();
      await loadStats();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    }
  };

  const handleClearQuarantine = async () => {
    if (!confirm(`Clear ALL quarantined jobs for queue ${queueName}? This cannot be undone.`)) {
      return;
    }

    try {
      await clearQuarantine(queueName!);
      toast({ title: 'Quarantine cleared', description: `All jobs have been removed from quarantine` });
      await loadQuarantine();
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
    if (reasonFilter !== 'ALL' && job.reason !== reasonFilter) return false;
    if (searchFilter && !job.jobId.includes(searchFilter) && !job.jobType.includes(searchFilter)) return false;
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
            <h1 className="text-3xl font-bold">Quarantine Lane</h1>
            <p className="text-muted-foreground text-sm">Suspicious jobs pending review</p>
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
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-yellow-600">{stats.total}</div>
              <p className="text-xs text-muted-foreground">Total Quarantined</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-red-600">{stats.byReason.repeated_failure || 0}</div>
              <p className="text-xs text-muted-foreground">Repeated Failures</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-orange-600">{stats.byReason.suspicious_payload || 0}</div>
              <p className="text-xs text-muted-foreground">Suspicious Payloads</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-purple-600">{stats.byReason.rate_abuse || 0}</div>
              <p className="text-xs text-muted-foreground">Rate Abuse</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-red-700">{stats.byReason.poison_pill || 0}</div>
              <p className="text-xs text-muted-foreground">Poison Pills</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium mb-2">Reason</label>
              <select
                value={reasonFilter}
                onChange={(e) => setReasonFilter(e.target.value)}
                className="w-full p-2 border rounded-md"
              >
                <option value="ALL">All Reasons</option>
                <option value="repeated_failure">Repeated Failure</option>
                <option value="suspicious_payload">Suspicious Payload</option>
                <option value="signature_mismatch">Signature Mismatch</option>
                <option value="rate_abuse">Rate Abuse</option>
                <option value="poison_pill">Poison Pill</option>
              </select>
            </div>

            <div className="flex-[2]">
              <label className="text-sm font-medium mb-2">Search</label>
              <input
                type="text"
                placeholder="Search by job ID or type..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="w-full p-2 border rounded-md"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Actions */}
      {selectedJobs.size > 0 && (
        <div className="flex items-center gap-2 p-4 bg-yellow-50 dark:bg-yellow-950 rounded-lg border border-yellow-200 dark:border-yellow-800">
          <ShieldAlert className="h-5 w-5 text-yellow-600" />
          <span className="text-sm font-medium">{selectedJobs.size} quarantined jobs selected</span>
          <Button size="sm" variant="destructive" onClick={handleBulkDelete}>
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Selected
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedJobs(new Set())}>
            Clear Selection
          </Button>
        </div>
      )}

      {/* Jobs List */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading quarantined jobs...</div>
          ) : filteredJobs.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">No quarantined jobs found.</div>
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
                            ? new Set(filteredJobs.map(j => j.jobId))
                            : new Set();
                          setSelectedJobs(newSelected);
                        }}
                      />
                    </th>
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Reason</th>
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Job Type</th>
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Attempts</th>
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Failed At</th>
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Error</th>
                    <th className="p-4 text-right text-xs font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map(job => (
                    <tr key={job.jobId} className="border-b hover:bg-muted/50 transition-colors">
                      <td className="p-4">
                        <input
                          type="checkbox"
                          checked={selectedJobs.has(job.jobId)}
                          onChange={() => toggleJobSelection(job.jobId)}
                        />
                      </td>
                      <td className="p-4 text-sm">
                        <Badge variant="outline">{job.reason}</Badge>
                      </td>
                      <td className="p-4 text-sm">{job.jobType}</td>
                      <td className="p-4 text-sm">{job.attempts}</td>
                      <td className="p-4 text-sm">{new Date(job.failedAt).toLocaleString()}</td>
                      <td className="p-4 text-sm text-red-600 line-clamp-2">{job.errorMessage}</td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handlePromote(job.jobId)}
                          >
                            <Play className="h-4 w-4 text-blue-500" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(job.jobId)}
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
          onClick={handleClearQuarantine}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Clear Quarantine
        </Button>
      </div>
    </div>
  );
}
