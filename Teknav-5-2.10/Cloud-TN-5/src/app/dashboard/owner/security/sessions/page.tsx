'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Search, Filter, Trash2, Lock, AlertTriangle, MoreVertical } from 'lucide-react';
import { formatDate, formatDistanceToNow } from 'date-fns';
import { revokeSession, revokeAllSessions } from './_actions/security';

/**
 * Owner Sessions Page
 * M10 - Security Center: "Session Hardening... Revocation"
 */

type Session = {
  id: number;
  userId: number;
  deviceId: string;
  ipAddress: string;
  ua: string;
  expiresAt: Date;
  createdAt: Date;
};

export default function OwnerSessionsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  
  // Filters
  const [filterQ, setFilterQ] = useState('');
  const [filterIp, setFilterIp] = useState('');
  const [filterDevice, setFilterDevice] = useState('');
  const [filterActive, setFilterActive] = useState<boolean>(true);

  useEffect(() => {
    loadSessions();
  }, [page, filterQ, filterIp, filterDevice, filterActive]);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const data = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/owner/security/sessions`, {
        method: 'GET',
        credentials: 'include',
      });

      if (!data.ok) {
        const error = await data.text();
        throw new Error(`Failed to load sessions: ${error}`);
      }

      const json = await data.json();
      setSessions(json.data);
      setTotal(json.total);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (sessionId: number) => {
    if (!confirm('Revoke this session?')) return;

    try {
      await revokeSession(sessionId);
      toast({ title: 'Session revoked' });
      loadSessions();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    }
  };

  const handleRevokeAll = async (userId: number) => {
    if (!confirm('Revoke ALL sessions for this user?')) return;

    try {
      await revokeAllSessions(userId);
      toast({ title: 'All sessions revoked' });
      loadSessions();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Sessions</h1>
        <Button variant="outline" size="icon" onClick={loadSessions}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 flex-1">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search user, IP..."
                value={filterQ}
                onChange={(e) => {
                  setFilterQ(e.target.value);
                  setPage(1);
                }}
                className="w-full"
              />
            </div>
            <Input
              placeholder="Filter by IP"
              value={filterIp}
              onChange={(e) => {
                setFilterIp(e.target.value);
                setPage(1);
              }}
              className="w-[150px]"
            />
            <Select value={filterActive ? 'true' : 'false'} onValueChange={(v) => {
              setFilterActive(v === 'true');
              setPage(1);
            }}>
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Active</SelectItem>
                <SelectItem value="false">Expired</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Sessions Table */}
      <Card>
        <CardHeader>
          <CardTitle>Sessions ({total})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Loading...</div>
          ) : sessions.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">No sessions found.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>IP / Device</TableHead>
                  <TableHead>UA</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell>
                      <div className="text-sm text-muted-foreground">
                        {formatDate(session.createdAt, 'PPpp')}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {formatDistanceToNow(session.createdAt, { addSuffix: true })}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-bold">User {session.userId}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs text-muted-foreground">
                        <div>{session.ipAddress || '-'}</div>
                        <div className="truncate max-w-[100px]">ID: {session.deviceId || '-'}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs text-muted-foreground truncate max-w-[150px]">
                        {session.ua || '-'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={new Date(session.expiresAt) > new Date() ? 'secondary' : 'outline'}>
                        {formatDistanceToNow(session.expiresAt, { addSuffix: true, includeSeconds: false })}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRevoke(session.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRevokeAll(session.userId)}
                        title="Revoke All"
                      >
                        <Lock className="h-4 w-4" />
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
