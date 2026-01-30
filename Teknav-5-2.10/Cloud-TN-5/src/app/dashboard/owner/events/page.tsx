'use client';

import { useEffect, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Play, Pause, Copy, AlertTriangle, Info, CheckCircle, XCircle, RotateCw } from 'lucide-react';
import { formatDate, formatDistanceToNow } from 'date-fns';

/**
 * Admin Events Feed Page
 *
 * Features:
 * - SSE Realtime Stream
 * - Filters (Severity, Workspace, Type)
 * - Pause/Resume Stream
 * - Copy Event JSON
 * - Jump to Entity Timeline
 */

type Event = {
  id: string;
  type: string;
  at: string;
  actorId?: number;
  workspaceId?: number;
  entityType: string;
  entityId: number;
  severity: 'info' | 'warn' | 'error';
  title: string;
  message: string;
  meta?: Record<string, any>;
};

export default function AdminEventsPage() {
  const { toast } = useToast();
  const [events, setEvents] = useState<Event[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [filterSeverity, setFilterSeverity] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterWorkspace, setFilterWorkspace] = useState<string>('');
  const eventSourceRef = useRef<EventSource | null>(null);
  const [reconnectCount, setReconnectCount] = useState(0);

  // Connect SSE
  useEffect(() => {
    if (eventSourceRef.current) return;

    const url = new URL(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/events/stream/admin`);
    if (filterSeverity) url.searchParams.set('severity', filterSeverity);
    if (filterType) url.searchParams.set('type', filterType);
    if (filterWorkspace) url.searchParams.set('workspaceId', filterWorkspace);

    const eventSource = new EventSource(url.toString());
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('SSE Connected');
    };

    eventSource.onmessage = (e) => {
      try {
        const event: { id, type, at, payload } = JSON.parse(e.data);
        const fullEvent = {
          id: event.id,
          type: event.type,
          at: event.at,
          ...event.payload,
        };

        if (isPaused) return;

        setEvents(prev => [fullEvent, ...prev].slice(0, 99));
      } catch (error) {
        console.error('Failed to parse SSE message', error);
      }
    };

    eventSource.onerror = () => {
      console.error('SSE Error');
      setReconnectCount(prev => prev + 1);
      if (reconnectCount > 5) {
        toast({ variant: 'destructive', title: 'Connection lost', description: 'Failed to connect to events stream.' });
        eventSource.close();
      }
    };

    return () => {
      eventSource.close();
    };
  }, [filterSeverity, filterType, filterWorkspace, isPaused]);

  const handleCopy = (event: Event) => {
    navigator.clipboard.writeText(JSON.stringify(event, null, 2));
    toast({ title: 'Event copied to clipboard' });
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'info':
        return <Badge variant="secondary"><Info className="h-3 w-3 mr-1" />Info</Badge>;
      case 'warn':
        return <Badge variant="outline" className="bg-yellow-100 text-yellow-800"><AlertTriangle className="h-3 w-3 mr-1" />Warning</Badge>;
      case 'error':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Error</Badge>;
      default:
        return <Badge>{severity}</Badge>;
    }
  };

  const getTypeBadge = (type: string) => {
    return <Badge variant="outline" className="text-xs">{type}</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Admin Events Feed</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setEvents([])}
          >
            <RotateCw className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsPaused(!isPaused)}
            title={isPaused ? 'Resume Stream' : 'Pause Stream'}
          >
            {isPaused ? <Play className="h-4 w-4 mr-2" /> : <Pause className="h-4 w-4 mr-2" />}
            {isPaused ? 'Resume' : 'Pause'}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="severity">Severity</Label>
              <Select value={filterSeverity} onValueChange={setFilterSeverity}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warn">Warning</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Label htmlFor="type">Type</Label>
              <Input
                id="type"
                placeholder="Search event type..."
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="w-[200px]"
              />
            </div>

            <div className="flex items-center gap-2">
              <Label htmlFor="workspace">Workspace ID</Label>
              <Input
                id="workspace"
                type="number"
                placeholder="Workspace ID..."
                value={filterWorkspace}
                onChange={(e) => setFilterWorkspace(e.target.value)}
                className="w-[200px]"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Events Feed */}
      <Card>
        <CardHeader>
          <CardTitle>Realtime Stream</CardTitle>
        </CardHeader>
        <CardContent className="max-h-[600px] overflow-y-auto space-y-2 p-4">
          {events.length === 0 && !eventSourceRef.current && (
            <div className="text-center text-muted-foreground py-4">Connecting to event stream...</div>
          )}
          {events.length === 0 && eventSourceRef.current && (
            <div className="text-center text-muted-foreground py-4">Waiting for events...</div>
          )}
          {events.map((event) => (
            <div key={event.id} className="border rounded-md p-3 bg-card">
              <div className="flex items-start justify-between">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    {getSeverityBadge(event.severity)}
                    {getTypeBadge(event.type)}
                    <span className="text-xs text-muted-foreground">
                      {formatDate(event.at, 'PPpp')} ({formatDistanceToNow(event.at, { addSuffix: true })})
                    </span>
                  </div>
                  <div className="font-bold text-sm">{event.title}</div>
                  <div className="text-sm text-muted-foreground">{event.message}</div>
                  {event.actorId && (
                    <div className="text-xs text-muted-foreground">
                      Actor ID: {event.actorId}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopy(event)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(`/dashboard/owner/timeline?entityType=${event.entityType}&entityId=${event.entityId}`, '_blank')}
                    title="View Timeline"
                  >
                    <AlertTriangle className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
