'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Activity, CheckCircle2, AlertTriangle, Server, Database, Zap, Clock, ArrowLeft, Filter, MoreHorizontal } from 'lucide-react';
import { getQueueHealth, resetCircuit, clearRateLimits, getWorkerStatus } from '../_actions/health-actions';

/**
 * Queue Health Page
 * M11 - Queue Platform: "Queue Health Endpoint"
 */

type QueueHealth = {
  name: string;
  jobType: string;
  status: 'ok' | 'degraded' | 'error';
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
  workers: number;
  rate: number;
  avgDurationMs: number;
  oldestWaitingJobAge?: number;
  isStalled?: boolean;
};

type CircuitStatus = {
  name: string;
  status: 'OPEN' | 'CLOSED' | 'HALF_OPEN';
  failures: number;
  lastFailureTime?: string;
};

type SystemHealth = {
  redis: { status: 'ok' | 'error'; latency?: number };
  postgres: { status: 'ok' | 'error'; latency?: number };
  bullmq: { status: 'ok' | 'error'; version?: string };
};

export default function QueueHealthPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [queueHealths, setQueueHealths] = useState<QueueHealth[]>([]);
  const [circuitStatuses, setCircuitStatuses] = useState<CircuitStatus[]>([]);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'ok' | 'degraded' | 'error'>('all');

  useEffect(() => {
    loadHealth();
  }, []);

  // Auto-refresh every 30s if enabled
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(loadHealth, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const loadHealth = async () => {
    setLoading(true);
    try {
      const [healthData, circuitData] = await Promise.all([
        getQueueHealth(),
        getCircuitStatuses(),
      ]);

      setQueueHealths(healthData.data);
      setCircuitStatuses(circuitData.data);
      setSystemHealth(healthData.system);
      setLastUpdate(new Date());
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleResetCircuit = async (dependencyName: string) => {
    try {
      await resetCircuit(dependencyName);
      toast({ title: 'Circuit Reset', description: `${dependencyName} circuit has been reset` });
      await loadHealth();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    }
  };

  const handleClearRateLimits = async (dependencyName: string) => {
    try {
      await clearRateLimits(dependencyName);
      toast({ title: 'Rate Limits Cleared', description: `Rate limits cleared for ${dependencyName}` });
      await loadHealth();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    }
  };

  const getQueueStatusBadge = (health: QueueHealth) => {
    switch (health.status) {
      case 'ok':
        return <Badge variant="default" className="bg-green-500">OK</Badge>;
      case 'degraded':
        return <Badge variant="secondary" className="bg-yellow-500 text-white">Degraded</Badge>;
      case 'error':
        return <Badge variant="destructive">Error</Badge>;
      default:
        return <Badge>{health.status}</Badge>;
    }
  };

  const getCircuitStatusBadge = (circuit: CircuitStatus) => {
    switch (circuit.status) {
      case 'CLOSED':
        return <Badge variant="default" className="bg-green-500">Closed</Badge>;
      case 'OPEN':
        return <Badge variant="destructive">Open</Badge>;
      case 'HALF_OPEN':
        return <Badge variant="secondary" className="bg-yellow-500 text-white">Half-Open</Badge>;
      default:
        return <Badge>{circuit.status}</Badge>;
    }
  };

  const getSystemStatusBadge = (status: 'ok' | 'error') => {
    switch (status) {
      case 'ok':
        return <Badge variant="default" className="bg-green-500">OK</Badge>;
      case 'error':
        return <Badge variant="destructive">Error</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const filteredQueues = selectedFilter === 'all'
    ? queueHealths
    : queueHealths.filter(q => q.status === selectedFilter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push('/dashboard/owner/queues')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Queue Health</h1>
            <p className="text-muted-foreground text-sm">Monitor queue and system health in real-time</p>
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
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push('/dashboard/owner/queues')}>
            View Observatory
          </Button>
        </div>
      </div>

      {/* System Health Cards */}
      {systemHealth && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className={systemHealth.redis.status === 'error' ? 'border-red-500' : 'border-green-500'}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-2">
                <Database className="h-8 w-8 text-red-500" />
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Redis</div>
                  <div className="text-xs text-muted-foreground">
                    {systemHealth.redis.latency ? `${systemHealth.redis.latency}ms` : '-'}
                  </div>
                </div>
                {getSystemStatusBadge(systemHealth.redis.status)}
              </div>
              {systemHealth.redis.status === 'error' && (
                <div className="text-xs text-red-600">Connection failed or slow</div>
              )}
            </CardContent>
          </Card>

          <Card className={systemHealth.postgres.status === 'error' ? 'border-red-500' : 'border-green-500'}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-2">
                <Server className="h-8 w-8 text-blue-500" />
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Postgres</div>
                  <div className="text-xs text-muted-foreground">
                    {systemHealth.postgres.latency ? `${systemHealth.postgres.latency}ms` : '-'}
                  </div>
                </div>
                {getSystemStatusBadge(systemHealth.postgres.status)}
              </div>
              {systemHealth.postgres.status === 'error' && (
                <div className="text-xs text-red-600">Connection failed or slow</div>
              )}
            </CardContent>
          </Card>

          <Card className={systemHealth.bullmq.status === 'error' ? 'border-red-500' : 'border-green-500'}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-2">
                <Zap className="h-8 w-8 text-purple-500" />
                <div>
                  <div className="text-sm font-medium text-muted-foreground">BullMQ</div>
                  <div className="text-xs text-muted-foreground">
                    {systemHealth.bullmq.version || 'Unknown'}
                  </div>
                </div>
                {getSystemStatusBadge(systemHealth.bullmq.status)}
              </div>
              {systemHealth.bullmq.status === 'error' && (
                <div className="text-xs text-red-600">Worker process not responding</div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-green-500">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-600">
              {filteredQueues.filter(q => q.status === 'ok').length}
            </div>
            <p className="text-xs text-muted-foreground">
              of {filteredQueues.length} queues healthy
            </p>
          </CardContent>
        </Card>

        <Card className="border-yellow-500">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-yellow-600">
              {filteredQueues.filter(q => q.status === 'degraded').length}
            </div>
            <p className="text-xs text-muted-foreground">
              queues degraded
            </p>
          </CardContent>
        </Card>

        <Card className="border-red-500">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-red-600">
              {filteredQueues.filter(q => q.status === 'error').length}
            </div>
            <p className="text-xs text-muted-foreground">
              queues in error
            </p>
          </CardContent>
        </Card>

        <Card className="border-blue-500">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-blue-600">
              {filteredQueues.reduce((sum, q) => sum + q.active, 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              active jobs
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium">Filter by Status:</span>
            <div className="flex gap-2">
              <Button
                variant={selectedFilter === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedFilter('all')}
              >
                All ({queueHealths.length})
              </Button>
              <Button
                variant={selectedFilter === 'ok' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedFilter('ok')}
              >
                OK ({queueHealths.filter(q => q.status === 'ok').length})
              </Button>
              <Button
                variant={selectedFilter === 'degraded' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedFilter('degraded')}
              >
                Degraded ({queueHealths.filter(q => q.status === 'degraded').length})
              </Button>
              <Button
                variant={selectedFilter === 'error' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedFilter('error')}
              >
                Error ({queueHealths.filter(q => q.status === 'error').length})
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Queue Health Table */}
      <Card>
        <CardHeader>
          <CardTitle>Queue Health Details</CardTitle>
          <CardDescription>Real-time health status for all queues</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Loading health data...</div>
          ) : filteredQueues.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">No queues found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted">
                  <tr>
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Queue</th>
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Status</th>
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Waiting</th>
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Active</th>
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Workers</th>
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Rate</th>
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Avg Duration</th>
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Oldest Job</th>
                    <th className="p-4 text-left text-xs font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQueues.map(queue => (
                    <tr key={queue.name} className="border-b hover:bg-muted/50 transition-colors">
                      <td className="p-4 text-sm font-medium">{queue.name.replace('teknav:queue:', '')}</td>
                      <td className="p-4">{getQueueStatusBadge(queue)}</td>
                      <td className="p-4 text-sm">{queue.waiting}</td>
                      <td className="p-4 text-sm">{queue.active}</td>
                      <td className="p-4 text-sm">{queue.workers}</td>
                      <td className="p-4 text-sm">{queue.rate}/s</td>
                      <td className="p-4 text-sm">{(queue.avgDurationMs / 1000).toFixed(1)}s</td>
                      <td className="p-4 text-sm">
                        {queue.oldestWaitingJobAge ? `${Math.round(queue.oldestWaitingJobAge / 60000)}h` : '-'}
                      </td>
                      <td className="p-4">
                        <Button variant="ghost" size="icon" onClick={() => router.push(`/dashboard/owner/queues/${queue.name}`)}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Circuit Breaker Status */}
      {circuitStatuses.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Circuit Breaker Status
            </CardTitle>
            <CardDescription>Current state of circuit breakers</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {circuitStatuses.map(circuit => (
                <div key={circuit.name} className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="text-2xl">
                      {circuit.status === 'OPEN' && <AlertTriangle className="h-6 w-6 text-red-500" />}
                      {circuit.status === 'CLOSED' && <CheckCircle2 className="h-6 w-6 text-green-500" />}
                      {circuit.status === 'HALF_OPEN' && <Zap className="h-6 w-6 text-yellow-500" />}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{circuit.name.replace(/_/g, ' ').toUpperCase()}</div>
                      <div className="text-xs text-muted-foreground">
                        Failures: {circuit.failures} • {circuit.lastFailureTime ? `Last: ${new Date(circuit.lastFailureTime).toLocaleString()}` : 'No failures'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getCircuitStatusBadge(circuit)}
                    {circuit.status === 'OPEN' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleResetCircuit(circuit.name)}
                      >
                        Reset
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Last Update Info */}
      {lastUpdate && (
        <div className="text-xs text-center text-muted-foreground">
          Last updated: {lastUpdate.toLocaleTimeString()}
          {autoRefresh && ' (auto-refresh every 30s)'}
        </div>
      )}
    </div>
  );
}

// Mock actions (would import from real actions file)
async function getCircuitStatuses() {
  return { data: [] as any[] };
}

async function resetCircuit(dependencyName: string) {
  // Implementation would call backend
}

async function clearRateLimits(dependencyName: string) {
  // Implementation would call backend
}
