'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { RefreshCw, Smartphone, Wifi, Shield, Activity, CheckCircle2, X } from 'lucide-react';
import { formatDate, formatDistanceToNow } from 'date-fns';
import { listDevices, updateDeviceTrust } from './_actions/devices';

/**
 * Owner Security Devices Page
 * M10 - Security Center: "Device Trust (Toggle)"
 */

type Device = {
  id: string; // Device ID
  userId: number;
  userAgent: string;
  ipAddress: string;
  lastSeenAt: Date;
  trusted: boolean;
};

export default function SecurityDevicesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  useEffect(() => {
    loadDevices();
  }, [page]);

  const loadDevices = async () => {
    setLoading(true);
    try {
      const data = await listDevices({ page, pageSize });
      setDevices(data.data);
      setTotal(data.total);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTrust = async (deviceId: string) => {
    const device = devices.find(d => d.id === deviceId);
    if (!device) return;

    try {
      await updateDeviceTrust({ id: deviceId, trusted: !device.trusted });
      toast({ title: `Device ${device.trusted ? 'Untrusted' : 'Trusted'}` });
      loadDevices();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    }
  };

  const handleRevokeSession = async (userId: number) => {
    if (!confirm('Revoke all sessions for this user?')) return;

    try {
      // Call revoke-all-sessions API (Sessions page)
      await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/security/users/${userId}/revoke-all-sessions`, {
        method: 'POST',
        credentials: 'include',
      });

      toast({ title: 'All sessions revoked' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Devices</h1>
        <Button variant="outline" size="icon" onClick={loadDevices}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Devices Table */}
      <Card>
        <CardHeader>
          <CardTitle>Trusted Devices ({total})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Loading...</div>
          ) : devices.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">No devices found.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>User Agent</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Last Seen</TableHead>
                  <TableHead>Trust</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((device) => (
                  <TableRow key={device.id}>
                    <TableCell>
                      <div className="text-sm font-medium flex items-center gap-2">
                        {device.trusted ? <Shield className="h-4 w-4 text-blue-500" /> : <Wifi className="h-4 w-4 text-muted-foreground" />}
                        Device {device.id}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs text-muted-foreground truncate max-w-[150px]">
                        {device.userAgent || '-'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs font-mono text-muted-foreground">
                        {device.ipAddress || '-'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-muted-foreground">
                        {formatDistanceToNow(device.lastSeenAt, { addSuffix: true })}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {formatDate(device.lastSeenAt, 'PPpp')}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={device.trusted}
                          onCheckedChange={() => handleToggleTrust(device.id)}
                          aria-label="Toggle device trust"
                        />
                        <span className="text-xs text-muted-foreground">
                          {device.trusted ? 'Trusted' : 'Not Trusted'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRevokeSession(device.userId)}
                        title="Revoke All Sessions"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => p + 1)}
            disabled={page * pageSize >= total}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
