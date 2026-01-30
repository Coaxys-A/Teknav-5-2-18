'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, Trash2, Shield, AlertTriangle, Monitor, XCircle, User, Search, Filter } from 'lucide-react';
import { formatDate, formatDistanceToNow } from 'date-fns';
import { getSessions, revokeSession, revokeAllUserSessions } from './_actions/sessions';
import { Breadcrumbs } from '@/components/shared/breadcrumbs';

/**
 * Admin Security Sessions Page
 *
 * Features:
 * - List Active Sessions
 * - Show Risk Flags (UA mismatch, IP change)
 * - Revoke Session (Writes AuditLog, Publishes Event)
 * - Revoke All User Sessions
 */

type Session = {
  id: string;
  userId: number;
  userEmail: string;
  workspaceId: number;
  ip: string;
  ua: string;
  geo?: { country: string; city: string };
  riskFlags: string[];
  createdAt: Date;
  lastActivity: Date;
  isActive: boolean;
};

export default function AdminSecuritySessionsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [filterUser, setFilterUser] = useState<string>('');
  const [filterRisk, setFilterRisk] = useState<string>('');

  // Load Sessions
  useEffect(() => {
    loadSessions();
  }, [page, filterUser, filterRisk]);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const response = await getSessions({
        userId: filterUser ? parseInt(filterUser) : undefined,
        page,
        pageSize,
        risk: filterRisk,
      });
      setSessions(response.data);
      setTotal(response.total);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm('Revoke this session?')) return;
    try {
      await revokeSession(id);
      toast({ title: 'Session revoked' });
      loadSessions();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to revoke', description: error.message });
    }
  };

  const handleRevokeAll = async (userId: string) => {
    if (!confirm(`Revoke all sessions for User ${userId}?`)) return;
    try {
      await revokeAllUserSessions(userId);
      toast({ title: 'All sessions revoked' });
      loadSessions();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to revoke', description: error.message });
    }
  };

  const getRiskBadge = (flags: string[]) => {
    if (flags.length === 0) return null;
    
    const hasCritical = flags.includes('CRITICAL_IP_JUMP') || flags.includes('CRITICAL_UA_CHANGE');
    
    if (hasCritical) {
      return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />High Risk</Badge>;
    }
    
    return <Badge variant="secondary"><Monitor className="h-3 w-3 mr-1" />Suspicious</Badge>;
  };

  const breadcrumbs = [
    { label: 'Admin', href: '/dashboard/admin' },
    { label: 'Security', href: '/dashboard/admin/security' },
    { label: 'Sessions', href: '/dashboard/admin/security/sessions' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Sessions</h1>
        <Button
          variant="outline"
          size="icon"
          onClick={loadSessions}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <Breadcrumbs items={breadcrumbs} />

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 flex-1">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search User ID..."
                value={filterUser}
                onChange={(e) => {
                  setFilterUser(e.target.value);
                  setPage(1);
                }}
                className="w-full"
              />
            </div>

            <Select value={filterRisk} onValueChange={setFilterRisk}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Risk" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All</SelectItem>
                <SelectItem value="CRITICAL">Critical</SelectItem>
                <SelectItem value="SUSPICIOUS">Suspicious</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Sessions Table */}
      <Card>
        <CardHeader>
          <CardTitle>Active Sessions ({total})</CardTitle>
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
                  <TableHead>User</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Device / UA</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Last Active</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell>
                      <div className="font-bold text-sm">{session.userEmail}</div>
                      <div className="text-xs text-muted-foreground">ID: {session.userId}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-xs">{session.ip}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs text-muted-foreground">
                        {session.geo?.country || '-'} / {session.geo?.city || '-'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <User className="h-3 w-3" />
                        {session.ua?.substring(0, 20) || 'Unknown'}...
                      </div>
                    </TableCell>
                    <TableCell>
                      {getRiskBadge(session.riskFlags)}
                    </TableCell>
                    <TableCell>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(session.lastActivity, 'PPpp')}
                        <div className="text-xs text-muted-foreground">
                          ({formatDistanceToNow(session.lastActivity, { addSuffix: true })})
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRevoke(session.id)}
                        >
                          <XCircle className="h-4 w-4" />
                          Revoke
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleRevokeAll(session.userId.toString())}
                          title="Revoke all for user"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
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
