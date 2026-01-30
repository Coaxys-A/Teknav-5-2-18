'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Play, Pause, AlertTriangle, CheckCircle2, Activity, Clock, Zap, Filter, MoreHorizontal } from 'lucide-react';
import { getQueuesOverview, pauseQueue, resumeQueue, cleanQueue } from './_actions/queues';
import { useEventStream } from '@/hooks/use-event-stream';

/**
 * Owner Queue Observatory Page (Overview)
 * M11 - Queue Platform: "Owner Queue Observatory UI"
 */

type QueueOverview = {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
  isStalled?: boolean;
  workers: number;
  rate: number;
  avgDurationMs: number;
  lastUpdatedAt: string;
};

type QueueEvent = {
  id: string;
  type: string;
  queueName?: string;
  status?: string;
  timestamp: string;
  metadata?: any;
};

export default function QueueObservatoryPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [queues, setQueues] = useState<QueueOverview[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [events, setEvents] = useState<QueueEvent[]>([]);

  useEffect(() => {
    loadQueues();
  }, []);

  // Auto-refresh every 10s if enabled
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(loadQueues, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  // SSE Listener for real-time queue events
  const { connected, connecting, error: sseError, lastEvent, eventCount, disconnect } = useEventStream(
    'teknav:queue:events',
    (event: QueueEvent) => {
      console.log('SSE Event received:', event);

      // Update queue stats based on event
      if (event.queueName) {
        updateQueueFromEvent(event);
      }

      // Add to event log (top 50)
      setEvents(prev => {
        const filtered = prev.filter(e => e.id !== event.id);
        return [event, ...filtered].slice(0, 50);
      });
    },
    {
      channel: 'all', // Listen to all queue events
      autoConnect: true,
      reconnectInterval: 5000, // Reconnect every 5s if disconnected
      maxReconnectAttempts: 10,
    },
  );

  const loadQueues = async () => {
    setLoading(true);
    try {
      const data = await getQueuesOverview();
      setQueues(data.data);
      setLastUpdate(new Date());
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const updateQueueFromEvent = (event: QueueEvent) => {
    if (!event.queueName) return;

    setQueues(prev => prev.map(queue => {
      if (queue.name !== event.queueName) return queue;

      // Update stats based on event type
      switch (event.type) {
        case 'job.enqueued':
          return { ...queue, waiting: queue.waiting + 1 };
        case 'job.started':
          return { ...queue, active: queue.active + 1, waiting: Math.max(0, queue.waiting - 1) };
        case 'job.completed':
          return { ...queue, active: Math.max(0, queue.active - 1), completed: queue.completed + 1 };
        case 'job.failed':
          return { ...queue, active: Math.max(0, queue.active - 1), failed: queue.failed + 1 };
        case 'job.moved_to_dlq':
          return { ...queue, failed: queue.failed + 1 };
        case 'queue.paused':
          return { ...queue, paused: true };
        case 'queue.resumed':
          return { ...queue, paused: false };
        default:
          return queue;
      }
    }));
  };

  const handlePause = async (queueName: string) => {
    try {
      await pauseQueue(queueName);
      toast({ title: 'Queue paused', description: `${queueName} is now paused` });
      await loadQueues();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    }
  };

  const handleResume = async (queueName: string) => {
    try {
      await resumeQueue(queueName);
      toast({ title: 'Queue resumed', description: `${queueName} is now active` });
      await loadQueues();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    }
  };

  const handleClean = async (queueName: string) => {
    if (!confirm(`Are you sure you want to clean ${queueName}? This will remove completed jobs.`)) {
      return;
    }

    try {
      await cleanQueue(queueName);
      toast({ title: 'Queue cleaned', description: `Completed jobs removed from ${queueName}` });
      await loadQueues();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    }
  };

  const getQueueStatus = (queue: QueueOverview) => {
    if (queue.paused) return { label: 'Paused', color: 'bg-gray-500 text-white' };
    if (queue.isStalled) return { label: 'Stalled', color: 'bg-red-500 text-white' };
    if (queue.failed > 10) return { label: 'Warning', color: 'bg-yellow-500 text-white' };
    return { label: 'Active', color: 'bg-green-500 text-white' };
  };

  const isQueueHealthy = (queue: QueueOverview) => {
    return !queue.paused && !queue.isStalled && queue.failed < 10;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Queue Observatory</h1>
          <p className="text-muted-foreground">Monitor and manage all job queues in real-time</p>
        </div>
        <div className="flex items-center gap-2">
          {/* SSE Status */}
          <Badge
            variant={connected ? 'default' : sseError ? 'destructive' : 'secondary'}
          >
            {connecting && 'SSE: Connecting...'}
            {connected && 'SSE: Connected'}
            {!connecting && !connected && 'SSE: Disconnected'}
            {sseError && 'SSE: Error'}
          </Badge>
          <Badge variant={autoRefresh ? 'default' : 'secondary'}>
            {autoRefresh ? 'Auto-Refresh: ON' : 'Auto-Refresh: OFF'}
          </Badge>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <Pause className={autoRefresh ? 'h-4 w-4' : 'h-4 w-4'} />
          </Button>
          <Button variant="outline" size="icon" onClick={() => { disconnect(); loadQueues(); }}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button onClick={() => router.push('/dashboard/owner/queues/health')}>
            <Activity className="h-4 w-4 mr-2" />
            Health Check
          </Button>
        </div>
      </div>

      {/* Overview Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-green-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              Healthy Queues
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {queues.filter(q => isQueueHealthy(q)).length}
            </div>
            <p className="text-xs text-muted-foreground">
              of {queues.length} queues
            </p>
          </CardContent>
        </Card>

        <Card className="border-red-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Failed Jobs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {queues.reduce((sum, q) => sum + q.failed, 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              across all queues
            </p>
          </CardContent>
        </Card>

        <Card className="border-blue-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4 text-blue-500" />
              Active Workers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {queues.reduce((sum, q) => sum + q.workers, 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              processing jobs
            </p>
          </CardContent>
        </Card>

        <Card className="border-purple-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4 text-purple-500" />
              Waiting Jobs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {queues.reduce((sum, q) => sum + q.waiting, 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              in queues
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Queue List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {queues.map(queue => {
          const status = getQueueStatus(queue);
          return (
            <Card
              key={queue.name}
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => router.push(`/dashboard/owner/queues/${queue.name}`)}
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base font-semibold">
                  {queue.name.replace('teknav:queue:', '')}
                </CardTitle>
                <Badge className={status.color}>
                  {status.label}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Queue Stats Grid */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 bg-blue-50 dark:bg-blue-950 rounded-lg">
                    <div className="text-lg font-bold text-blue-600 dark:text-blue-400">{queue.waiting}</div>
                    <div className="text-xs text-muted-foreground">Waiting</div>
                  </div>
                  <div className="p-2 bg-green-50 dark:bg-green-950 rounded-lg">
                    <div className="text-lg font-bold text-green-600 dark:text-green-400">{queue.active}</div>
                    <div className="text-xs text-muted-foreground">Active</div>
                  </div>
                  <div className="p-2 bg-gray-50 dark:bg-gray-950 rounded-lg">
                    <div className="text-lg font-bold text-gray-600 dark:text-gray-400">{queue.completed}</div>
                    <div className="text-xs text-muted-foreground">Done</div>
                  </div>
                </div>

                {/* Additional Stats */}
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Failed:</span>
                    <span className={queue.failed > 0 ? 'text-red-600 font-semibold' : ''}>
                      {queue.failed}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Workers:</span>
                    <span className="text-blue-600">{queue.workers}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Rate:</span>
                    <span className="text-purple-600">{queue.rate}/s</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Avg Duration:</span>
                    <span className="text-gray-600">{(queue.avgDurationMs / 1000).toFixed(1)}s</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-2 border-t">
                  {queue.paused ? (
                    <Button
                      size="sm"
                      variant="default"
                      className="flex-1"
                      onClick={(e) => { e.stopPropagation(); handleResume(queue.name); }}
                    >
                      <Play className="h-3 w-3 mr-1" />
                      Resume
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={(e) => { e.stopPropagation(); handlePause(queue.name); }}
                    >
                      <Pause className="h-3 w-3 mr-1" />
                      Pause
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); handleClean(queue.name); }}
                  >
                    <Filter className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/owner/queues/${queue.name}`); }}
                  >
                    <MoreHorizontal className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Real-time Events Stream */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-blue-500" />
            Real-time Events ({eventCount})
          </CardTitle>
          <CardDescription>Latest queue state transitions (SSE Connected: {connected ? 'Yes' : 'No'})</CardDescription>
        </CardHeader>
        <CardContent>
          {eventCount === 0 && (
            <div className="py-8 text-center text-muted-foreground">No events yet. Start processing jobs to see events here.</div>
          )}
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {events.map((event) => (
              <div key={event.id} className="flex items-center justify-between p-2 border rounded-md bg-background hover:bg-accent transition-colors">
                <div className="flex items-center gap-2 flex-1">
                  {event.type.includes('enqueued') && <Activity className="h-4 w-4 text-blue-500" />}
                  {event.type.includes('started') && <Play className="h-4 w-4 text-green-500" />}
                  {event.type.includes('completed') && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                  {event.type.includes('failed') && <AlertTriangle className="h-4 w-4 text-red-500" />}
                  {event.type.includes('paused') && <Pause className="h-4 w-4 text-gray-500" />}
                  <div className="text-sm font-medium">{event.type.replace(/\./g, ' ').toUpperCase()}</div>
                  {event.queueName && (
                    <Badge variant="outline" className="text-xs">
                      {event.queueName.replace('teknav:queue:', '')}
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(event.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Last Update Info */}
      {lastUpdate && (
        <div className="text-xs text-center text-muted-foreground">
          Last updated: {lastUpdate.toLocaleTimeString()}
          {autoRefresh && ' (auto-refresh every 10s + SSE streaming)'}
          {connected && ' (SSE real-time updates)'}
        </div>
      )}
    </div>
  );
}
