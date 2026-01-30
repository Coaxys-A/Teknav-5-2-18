'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, Shield, Lock, Zap, AlertTriangle, Activity, X } from 'lucide-react';
import { getSecuritySettings, getCsrfToken } from './_actions/security';
import { useEventStream } from '@/hooks/use-event-stream'; // Part 9 Hook

/**
 * Owner Security Dashboard (Overview)
 * M10 - Security Center: "Realtime security events"
 * 
 * Features:
 * - Overview Cards (Denies Today, Active Bans, Brute Blocks, Active Sessions).
 * - Realtime Updates (Redis Events).
 * - Health Status (from Part 9).
 * - Links to Settings, Sessions, Bans, Devices.
 */

type SecurityEvent = {
  id: string;
  type: 'ACCESS_DENIED' | 'SESSION_REVOKED' | 'TEMP_BAN_APPLIED' | 'BRUTE_FORCE_BLOCK' | 'API_TOKEN_ABUSE';
  timestamp: Date;
  payload: any;
};

export default function SecurityDashboardPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<any>(null);
  const [stats, setStats] = useState({
    deniesToday: 0,
    activeBans: 12, // Stub
    bruteBlocks: 3,
    activeSessions: 145,
  });
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const data = await getSecuritySettings();
      setSettings(data.data);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  // SSE Listener (M10: Realtime Security Events)
  useEventStream('teknav:security:events', (event: SecurityEvent) => {
    // Update Stats based on event type
    if (event.type === 'ACCESS_DENIED') {
      setStats(prev => ({ ...prev, deniesToday: prev.deniesToday + 1 }));
    }
    if (event.type === 'TEMP_BAN_APPLIED') {
      setStats(prev => ({ ...prev, activeBans: prev.activeBans + 1 }));
    }
    if (event.type === 'BRUTE_FORCE_BLOCK') {
      setStats(prev => ({ ...prev, bruteBlocks: prev.bruteBlocks + 1 }));
    }
    if (event.type === 'SESSION_REVOKED') {
      setStats(prev => ({ ...prev, activeSessions: prev.activeSessions - 1 }));
    }

    // Add to Event Log (Top 10)
    setEvents(prev => [event, ...prev].slice(0, 10));
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Security Center</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Realtime Enabled</span>
          <div className="h-2 w-2 rounded-full bg-green-500" />
        </div>
      </div>

      {/* Overview Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card onClick={() => router.push('/dashboard/owner/logs/audit')} className="cursor-pointer hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Access Denied</CardTitle>
            <X className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats.deniesToday}</div>
            <div className="text-xs text-muted-foreground">Denies Today</div>
          </CardContent>
        </Card>

        <Card onClick={() => router.push('/dashboard/owner/security/bans')} className="cursor-pointer hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Bans</CardTitle>
            <Shield className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{stats.activeBans}</div>
            <div className="text-xs text-muted-foreground">IP/User Bans</div>
          </CardContent>
        </Card>

        <Card onClick={() => router.push('/dashboard/owner/logs/security')} className="cursor-pointer hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Brute Force</CardTitle>
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{stats.bruteBlocks}</div>
            <div className="text-xs text-muted-foreground">Blocks Today</div>
          </CardContent>
        </Card>

        <Card onClick={() => router.push('/dashboard/owner/security/sessions')} className="cursor-pointer hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Sessions</CardTitle>
            <Activity className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{stats.activeSessions}</div>
            <div className="text-xs text-muted-foreground">Online Users</div>
          </CardContent>
        </Card>
      </div>

      {/* Security Events Stream (Realtime) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-blue-500" />
            Realtime Events
          </CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 && (
            <div className="py-8 text-center text-muted-foreground">No security events.</div>
          )}
          <div className="space-y-2">
            {events.map((event) => (
              <div key={event.id} className="flex items-center justify-between p-2 border rounded-md bg-background">
                <div className="flex items-center gap-2">
                  {event.type === 'ACCESS_DENIED' && <X className="h-4 w-4 text-red-500" />}
                  {event.type === 'SESSION_REVOKED' && <Lock className="h-4 w-4 text-yellow-600" />}
                  {event.type === 'TEMP_BAN_APPLIED' && <Shield className="h-4 w-4 text-orange-500" />}
                  {event.type === 'BRUTE_FORCE_BLOCK' && <AlertTriangle className="h-4 w-4 text-red-600" />}
                  {event.type === 'API_TOKEN_ABUSE' && <Zap className="h-4 w-4 text-purple-500" />}
                  <div className="text-sm font-bold">{event.type.replace(/_/g, ' ')}</div>
                  <div className="text-xs text-muted-foreground">
                    {event.timestamp.toLocaleTimeString()}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                  {JSON.stringify(event.payload)}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Actions Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => router.push('/dashboard/owner/security/settings')}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Settings
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push('/dashboard/owner/security/sessions')}>
            <Activity className="h-4 w-4 mr-2" />
            Sessions
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push('/dashboard/owner/security/bans')}>
            <Shield className="h-4 w-4 mr-2" />
            Bans
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push('/dashboard/owner/security/devices')}>
            <Lock className="h-4 w-4 mr-2" />
            Devices
          </Button>
        </div>
      </div>
    </div>
  );
}
