'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, Play, Pause, XCircle, Search, Filter, Clock, CheckCircle, AlertTriangle, Activity } from 'lucide-react';
import { getAdminStats } from './_actions/queues';
import { Breadcrumbs } from '@/components/shared/breadcrumbs';

/**
 * Admin Queues Page
 *
 * Features:
 * - Queue Stats (Depth, Failures)
 * - Realtime Updates (Polling/SSE)
 * - Filter by Status
 * - Charts (Simple bars)
 */

type QueueStats = {
  queueName: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  total: number;
};

export default function AdminQueuesPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<QueueStats[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterType, setFilterType] = useState<'all' | 'ai' | 'workflow' | 'billing' | 'email'>('all');
  const [activeTab, setActiveTab] = useState<'all' | 'ai' | 'workflow' | 'billing' | 'email'>('all');

  // Load Stats
  useEffect(() => {
    loadStats();
  }, [filterStatus, filterType]);

  const loadStats = async () => {
    setLoading(true);
    try {
      const response = await getAdminStats();
      setStats(response.data);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  // Realtime Polling (30s)
  useEffect(() => {
    const interval = setInterval(loadStats, 30000);
    return () => clearInterval(interval);
  }, [filterStatus]);

  const filteredStats = stats.filter(stat => {
    if (filterType === 'ai' && !stat.queueName.startsWith('ai')) return false;
    if (filterType === 'workflow' && !stat.queueName.startsWith('workflow')) return false;
    if (filterType === 'billing' && !stat.queueName.startsWith('billing')) return false;
    if (filterType === 'email' && !stat.queueName.startsWith('email')) return false;
    return true;
  });

  const breadcrumbs = [
    { label: 'Admin', href: '/dashboard/admin' },
    { label: 'Queues', href: '/dashboard/admin/queues' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Queues</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setStats([])}
          >
            <XCircle className="h-4 w-4 mr-2" />
            Clear View
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={loadStats}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Breadcrumbs items={breadcrumbs} />

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter status..."
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-[200px]"
              />
            </div>

            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="ai">AI</SelectItem>
                <SelectItem value="workflow">Workflow</SelectItem>
                <SelectItem value="billing">Billing</SelectItem>
                <SelectItem value="email">Email</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredStats.map((stat) => (
          <Card key={stat.queueName}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">{stat.queueName}</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-2xl font-bold">{stat.active}</div>
                  <div className="text-xs text-muted-foreground">Active</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">{stat.waiting}</div>
                  <div className="text-xs text-muted-foreground">Waiting</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">{stat.completed}</div>
                  <div className="text-xs text-muted-foreground">Completed</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-destructive">{stat.failed}</div>
                  <div className="text-xs text-muted-foreground">Failed</div>
                </div>
              </div>
              {/* Simple Bar Chart (Depth) */}
              <div className="w-full bg-secondary h-2 rounded-full mt-4 relative overflow-hidden">
                <div
                  className="bg-primary h-2 absolute left-0 top-0 transition-all duration-1000"
                  style={{ width: `${(stat.waiting / stat.total) * 100}%` }}
                />
                <div
                  className="bg-destructive h-2 absolute top-0 transition-all duration-1000"
                  style={{ left: `${(stat.waiting / stat.total) * 100}%`, width: `${(stat.failed / stat.total) * 100}%` }}
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table View (Stubbed) */}
      <Card>
        <CardHeader>
          <CardTitle>Job List</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-4">
            Select a queue to view active jobs.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
