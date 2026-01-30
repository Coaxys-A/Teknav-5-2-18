'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowLeft, RefreshCw, RotateCcw, Trash2, Eye, Clock, Zap, AlertTriangle, Copy, Calendar, User, FileText, Activity, ChevronLeft, ChevronRight } from 'lucide-react';
import { getJobDetails, retryJob, cancelJob } from '../../../_actions/job-actions';

/**
 * Job Detail Page
 * M11 - Queue Platform: "Owner Queue Observatory UI"
 */

type JobDetails = {
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
  payload: any;
  metadata?: {
    aiModel?: string;
    tokensUsed?: number;
    cost?: number;
    output?: any;
  };
};

type JobEvent = {
  id: string;
  type: string;
  timestamp: string;
  message: string;
  data?: any;
};

type RelatedEntity = {
  type: string;
  id: string | number;
  name: string;
  link: string;
};

export default function JobDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { queueName, aiJobId } = params;
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [job, setJob] = useState<JobDetails | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (queueName && aiJobId) {
      loadJobDetails();
      loadJobEvents();
    }
  }, [queueName, aiJobId]);

  const loadJobDetails = async () => {
    setLoading(true);
    try {
      const data = await getJobDetails(queueName, parseInt(aiJobId));
      setJob(data.data);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const loadJobEvents = async () => {
    try {
      // In production, this would fetch from audit logs
      // For MVP, we'll simulate events
      const simulatedEvents = [
        {
          id: `evt-1-${Date.now()}`,
          type: 'JOB_ENQUEUED',
          timestamp: new Date(Date.now() - 60000).toISOString(),
          message: 'Job added to queue',
        },
        {
          id: `evt-2-${Date.now()}`,
          type: 'JOB_STARTED',
          timestamp: new Date(Date.now() - 55000).toISOString(),
          message: 'Worker picked up job',
        },
      ];

      setEvents(simulatedEvents);
    } catch (error: any) {
      console.error('Failed to load job events', error);
    }
  };

  const handleRetry = async () => {
    if (!job) return;

    if (!confirm('Retry this job? This will create a new job with the same payload.')) {
      return;
    }

    try {
      await retryJob(queueName!, job.aiJobId);
      toast({ title: 'Job retried', description: 'Job has been added back to the queue' });
      await loadJobDetails();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    }
  };

  const handleCancel = async () => {
    if (!job) return;

    if (!confirm('Cancel this job? This cannot be undone.')) {
      return;
    }

    try {
      await cancelJob(queueName!, job.aiJobId);
      toast({ title: 'Job cancelled', description: 'Job has been cancelled' });
      await loadJobDetails();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: 'Copied to clipboard' });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'WAITING':
        return <Badge variant="outline">Waiting</Badge>;
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

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'JOB_ENQUEUED':
        return <Zap className="h-4 w-4 text-blue-500" />;
      case 'JOB_STARTED':
        return <Activity className="h-4 w-4 text-green-500" />;
      case 'JOB_COMPLETED':
        return <Eye className="h-4 w-4 text-green-600" />;
      case 'JOB_FAILED':
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
      case 'JOB_RETRIED':
        return <RotateCcw className="h-4 w-4 text-yellow-500" />;
      case 'JOB_MOVED_TO_DLQ':
        return <Trash2 className="h-4 w-4 text-red-600" />;
      case 'JOB_CANCELLED':
        return <X className="h-4 w-4 text-gray-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-400" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading job details...</p>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center text-muted-foreground">
          Job not found
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/dashboard/owner/queues/${queueName}`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Job Details</h1>
            <p className="text-muted-foreground text-sm">{queueName?.replace('teknav:queue:', '')} • {job.jobType.replace(/\./g, ' ')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={loadJobDetails}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          {(job.status === 'FAILED' || job.status === 'CANCELLED') && (
            <Button variant="default" size="sm" onClick={handleRetry}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Retry Job
            </Button>
          )}
          {(job.status === 'WAITING' || job.status === 'ACTIVE') && (
            <Button variant="destructive" size="sm" onClick={handleCancel}>
              <Trash2 className="h-4 w-4 mr-2" />
              Cancel Job
            </Button>
          )}
        </div>
      </div>

      {/* Status Card */}
      <Card className={job.status === 'FAILED' ? 'border-red-500' : ''}>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="text-4xl">
                {job.status === 'ACTIVE' && <Activity className="h-12 w-12 text-green-500 animate-pulse" />}
                {job.status === 'COMPLETED' && <Eye className="h-12 w-12 text-green-600" />}
                {job.status === 'FAILED' && <AlertTriangle className="h-12 w-12 text-red-500" />}
                {job.status === 'WAITING' && <Clock className="h-12 w-12 text-gray-400" />}
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Job Status</div>
                <div className="text-2xl font-bold">{getStatusBadge(job.status)}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-muted-foreground">Attempts</div>
              <div className="text-2xl font-bold">{job.attempts}/{job.maxAttempts}</div>
            </div>
          </div>

          {job.errorMessage && (
            <div className="mt-4 p-4 bg-red-50 dark:bg-red-950 rounded-lg border border-red-200 dark:border-red-800">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-red-900 dark:text-red-100">Error Message</div>
                  <p className="text-sm text-red-700 dark:text-red-300 mt-1">{job.errorMessage}</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="payload">Payload</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Job Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Job Type</label>
                  <div className="text-sm font-mono">{job.jobType}</div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Trace ID</label>
                  <div className="flex items-center gap-2">
                    <code className="text-xs bg-muted px-2 py-1 rounded">{job.traceId.substring(0, 16)}...</code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => copyToClipboard(job.traceId)}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Entity</label>
                  <div className="text-sm">{job.entity.type}:{job.entity.id}</div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Actor ID</label>
                  <div className="text-sm">{job.actorId || '-'}</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Created At</label>
                  <div className="text-sm">{new Date(job.createdAt).toLocaleString()}</div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Started At</label>
                  <div className="text-sm">{job.startedAt ? new Date(job.startedAt).toLocaleString() : '-'}</div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Finished At</label>
                  <div className="text-sm">{job.finishedAt ? new Date(job.finishedAt).toLocaleString() : '-'}</div>
                </div>
              </div>

              {job.durationMs && (
                <div className="mt-4">
                  <label className="text-sm font-medium text-muted-foreground">Duration</label>
                  <div className="text-2xl font-bold">{(job.durationMs / 1000).toFixed(2)}s</div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Related Entity */}
          <Card>
            <CardHeader>
              <CardTitle>Related Entity</CardTitle>
              <CardDescription>Quick links to related resources</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
                <FileText className="h-8 w-8 text-blue-500" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{job.entity.type}</div>
                  <div className="text-xs text-muted-foreground">ID: {job.entity.id}</div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    // Navigate to entity page
                    if (job.entity.type === 'ARTICLE') {
                      router.push(`/dashboard/owner/articles/${job.entity.id}`);
                    } else if (job.entity.type === 'USER') {
                      router.push(`/dashboard/owner/users/${job.entity.id}`);
                    }
                  }}
                >
                  <Eye className="h-4 w-4 mr-2" />
                  View
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Payload Tab */}
        <TabsContent value="payload">
          <Card>
            <CardHeader>
              <CardTitle>Job Payload</CardTitle>
              <CardDescription>Full job envelope and data</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[600px] w-full border rounded-md p-4">
                <pre className="text-xs bg-muted p-4 rounded overflow-auto">
                  {JSON.stringify(job.payload, null, 2)}
                </pre>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Timeline Tab */}
        <TabsContent value="timeline">
          <Card>
            <CardHeader>
              <CardTitle>Job Timeline</CardTitle>
              <CardDescription>Event history for this job</CardDescription>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">No events recorded yet.</div>
              ) : (
                <div className="relative pl-8 border-l-2 border-gray-200 space-y-6">
                  {events.map((event, index) => (
                    <div key={event.id} className="relative">
                      {/* Event Node */}
                      <div className="absolute -left-10 p-2 bg-background border-2 border-white shadow-sm rounded-full">
                        {getEventIcon(event.type)}
                      </div>

                      {/* Event Content */}
                      <div className="p-4 bg-background rounded-lg border shadow-sm">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {event.type.replace(/\./g, ' ')}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {new Date(event.timestamp).toLocaleString()}
                            </span>
                          </div>
                        </div>
                        <p className="text-sm">{event.message}</p>
                        {event.data && (
                          <details className="mt-2">
                            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                              View Details
                            </summary>
                            <pre className="mt-2 text-xs bg-muted p-2 rounded">
                              {JSON.stringify(event.data, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <CardTitle>Job Logs</CardTitle>
              <CardDescription>Detailed logs and errors</CardDescription>
            </CardHeader>
            <CardContent>
              {job.errorMessage ? (
                <div className="space-y-4">
                  <div className="p-4 bg-red-50 dark:bg-red-950 rounded-lg border border-red-200 dark:border-red-800">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0" />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-red-900 dark:text-red-100">Error Details</div>
                        <div className="text-sm text-red-700 dark:text-red-300 mt-1">{job.errorMessage}</div>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-gray-50 dark:bg-gray-950 rounded-lg">
                    <div className="text-sm">
                      <div className="font-medium mb-2">Additional Information</div>
                      <div className="space-y-1">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Attempts:</span>
                          <span>{job.attempts}/{job.maxAttempts}</span>
                        </div>
                        {job.metadata?.tokensUsed && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Tokens Used:</span>
                            <span>{job.metadata.tokensUsed}</span>
                          </div>
                        )}
                        {job.metadata?.cost && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Cost:</span>
                            <span>${job.metadata.cost.toFixed(4)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground">
                  No logs available for this job.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Toast Notification */}
      {copied && (
        <div className="fixed bottom-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg animate-in fade-in slide-in-from-bottom-4">
          Copied to clipboard
        </div>
      )}
    </div>
  );
}
