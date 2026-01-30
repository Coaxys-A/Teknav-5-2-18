'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { FileText, Clock, CheckCircle, XCircle, User, Search, Filter, RefreshCw, FilePlus, FileEdit, BarChart } from 'lucide-react';
import { formatDate, formatDistanceToNow } from 'date-fns';
import {
  getReviewQueue,
  assignReviewer,
  approveArticle,
  rejectArticle,
  createQualityReport,
  getQualityReports,
} from './_actions/review';
import { Breadcrumbs } from '@/components/shared/breadcrumbs';

/**
 * Admin/Editor Review Queue Page
 *
 * Features:
 * - Review Queue (SUBMITTED articles)
 * - Assignment of reviewer (optional) + review notes
 * - Approve/Reject actions (server-enforced transitions)
 * - Quality report creation + retrieval
 * - Realtime updates using Redis Pub/Sub
 */

type Article = {
  id: number;
  title: string;
  status: string;
  categoryId: number;
  authorId: number;
  reviewerId: number | null;
  reviewerNotes: string | null;
  submittedAt: Date;
  publishedAt: Date | null;
  rejectionReason: string | null;
};

export default function AdminReviewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [articles, setArticles] = useState<Article[]>([]);
  const [total, setTotal] = useState(0);
  const [activeTab, setActiveTab] = useState<'queue' | 'reports'>('queue');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [filterStatus, setFilterStatus] = useState<string>(searchParams.get('status') || 'SUBMITTED');
  const [q, setQ] = useState<string>(searchParams.get('q') || '');
  const [filterCategory, setFilterCategory] = useState<number | undefined>(searchParams.get('categoryId') ? parseInt(searchParams.get('categoryId')!) : undefined);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [isApproveOpen, setIsApproveOpen] = useState(false);
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isReportsListOpen, setIsReportsListOpen] = useState(false);
  const [reports, setReports] = useState<any[]>([]);
  const [assignForm, setAssignForm] = useState({ reviewerId: '', notes: '' });
  const [rejectReason, setRejectReason] = useState('');
  const [reportForm, setReportForm] = useState({ score: 0, feedback: '' });

  // Load Queue
  useEffect(() => {
    loadQueue();
  }, [page, filterStatus, q, filterCategory]);

  const loadQueue = async () => {
    setLoading(true);
    try {
      const response = await getReviewQueue({
        status: filterStatus,
        q,
        categoryId: filterCategory,
        page,
        pageSize,
        sort: 'createdAt',
        order: 'desc',
      });
      setArticles(response.data);
      setTotal(response.total);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  // Approve
  const handleApprove = async () => {
    if (!selectedArticle) return;
    setLoading(true);
    try {
      await approveArticle(selectedArticle.id.toString());
      toast({ title: 'Article approved' });
      loadQueue();
      setIsApproveOpen(false);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to approve', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  // Reject
  const handleReject = async () => {
    if (!selectedArticle || !rejectReason.trim()) {
      toast({ variant: 'destructive', title: 'Reason required' });
      return;
    }
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('reason', rejectReason);
      await rejectArticle(selectedArticle.id.toString(), formData);
      toast({ title: 'Article rejected' });
      loadQueue();
      setIsRejectOpen(false);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to reject', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  // Assign
  const handleAssign = async () => {
    if (!selectedArticle || !assignForm.reviewerId) {
      toast({ variant: 'destructive', title: 'Reviewer ID required' });
      return;
    }
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('reviewerId', assignForm.reviewerId);
      formData.append('notes', assignForm.notes);
      await assignReviewer(selectedArticle.id.toString(), assignForm.reviewerId, assignForm.notes);
      toast({ title: 'Reviewer assigned' });
      loadQueue();
      setIsAssignOpen(false);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to assign', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  // Create Quality Report
  const handleCreateReport = async () => {
    if (!selectedArticle) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('score', reportForm.score.toString());
      formData.append('feedback', reportForm.feedback);
      await createQualityReport(selectedArticle.id.toString(), formData);
      toast({ title: 'Quality report created' });
      setIsReportOpen(false);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to create report', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  // Load Reports
  const handleLoadReports = async () => {
    if (!selectedArticle) return;
    setLoading(true);
    try {
      const data = await getQualityReports(selectedArticle.id.toString());
      setReports(data);
      setIsReportsListOpen(true);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to load reports', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  // Breadcrumbs
  const breadcrumbs = [
    { label: 'Admin', href: '/dashboard/admin' },
    { label: 'Review', href: '/dashboard/admin/review' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Review Queue</h1>
        <Button
          variant="outline"
          size="icon"
          onClick={loadQueue}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <Breadcrumbs items={breadcrumbs} />

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            {/* Search */}
            <div className="flex items-center gap-2 flex-1">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search articles..."
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                className="w-full"
              />
            </div>

            {/* Status Filter */}
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SUBMITTED">In Review</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
                <SelectItem value="READY_FOR_PUBLISH">Ready</SelectItem>
                <SelectItem value="PUBLISHED">Published</SelectItem>
              </SelectContent>
            </Select>
          </Select>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>
        
        {/* Tab: Queue */}
        <TabsContent value="queue" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Articles ({filterStatus}) ({total})</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="py-8 text-center text-muted-foreground">Loading...</div>
              ) : articles.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">No articles found.</div>
              ) : (
                <div className="space-y-4">
                  {articles.map((article) => (
                    <div key={article.id} className="border rounded-md p-4 flex items-start justify-between gap-4">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center justify-between">
                          <h3 className="font-bold text-foreground">{article.title}</h3>
                          <Badge variant="outline">{article.status}</Badge>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          ID: {article.id} | Author: {article.authorId} | Category: {article.categoryId || '-'}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Submitted: {article.submittedAt ? formatDate(article.submittedAt, 'PPpp') : '-'}
                        </div>
                        {article.reviewerId && (
                          <div className="flex items-center gap-2 text-sm">
                            <User className="h-3 w-3" />
                            <span>Reviewer: {article.reviewerId}</span>
                            {article.reviewerNotes && (
                              <span className="italic text-muted-foreground">({article.reviewerNotes})</span>
                            )}
                          </div>
                        )}
                        {article.status === 'REJECTED' && (
                          <div className="text-sm text-destructive">
                            Rejected: {article.rejectionReason || 'See feedback'}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-start gap-2">
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedArticle(article);
                              setIsApproveOpen(true);
                            }}
                            disabled={article.status !== 'SUBMITTED'}
                          >
                            <CheckCircle className="h-4 w-4 text-green-600" />
                            Approve
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedArticle(article);
                              setIsRejectOpen(true);
                            }}
                            disabled={article.status !== 'SUBMITTED'}
                          >
                            <XCircle className="h-4 w-4 text-destructive" />
                            Reject
                          </Button>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedArticle(article);
                              setIsAssignOpen(true);
                            }}
                          >
                            <User className="h-4 w-4" />
                            Assign
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedArticle(article);
                              setIsReportOpen(true);
                            }}
                          >
                            <BarChart className="h-4 w-4" />
                            Report
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleLoadReports(article.id)}
                          >
                            <FileEdit className="h-4 w-4" />
                            Reports
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: Reports */}
        <TabsContent value="reports" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Quality Reports</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="py-8 text-center text-muted-foreground">Loading...</div>
              ) : reports.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">No quality reports created yet.</div>
              ) : (
                <div className="space-y-2">
                  {reports.map((report) => (
                    <div key={report.id} className="border rounded-md p-3 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-bold">Score: {report.score}/10</div>
                        <div className="text-sm text-muted-foreground">
                          {report.feedback}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {report.createdAt ? formatDate(report.createdAt, 'PPpp') : '-'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

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

      {/* Approve Dialog */}
      <Dialog open={isApproveOpen} onOpenChange={setIsApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Article</DialogTitle>
            <DialogDescription>
              Are you sure you want to approve this article? It will transition to APPROVED state.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsApproveOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleApprove}
              disabled={loading}
            >
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={isRejectOpen} onOpenChange={setIsRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Article</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejection.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              placeholder="Reason for rejection..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="min-h-[100px]"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleReject}
              disabled={loading}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Reviewer Dialog */}
      <Dialog open={isAssignOpen} onOpenChange={setIsAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Reviewer</DialogTitle>
            <DialogDescription>
              Assign a reviewer to this article.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reviewerId">Reviewer ID</Label>
              <Input
                id="reviewerId"
                type="number"
                placeholder="User ID"
                value={assignForm.reviewerId}
                onChange={(e) => setAssignForm({ ...assignForm, reviewerId: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                placeholder="Internal notes..."
                value={assignForm.notes}
                onChange={(e) => setAssignForm({ ...assignForm, notes: e.target.value })}
                className="min-h-[80px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsAssignOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleAssign} disabled={loading}>
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Quality Report Dialog */}
      <Dialog open={isReportOpen} onOpenChange={setIsReportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Quality Report</DialogTitle>
            <DialogDescription>
              Rate article quality (1-10).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="score">Score (1-10)</Label>
              <Input
                id="score"
                type="number"
                min={1}
                max={10}
                value={reportForm.score}
                onChange={(e) => setReportForm({ ...reportForm, score: parseInt(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="feedback">Feedback</Label>
              <Textarea
                id="feedback"
                placeholder="Quality feedback..."
                value={reportForm.feedback}
                onChange={(e) => setReportForm({ ...reportForm, feedback: e.target.value })}
                className="min-h-[100px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsReportOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleCreateReport} disabled={loading}>
              Create Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
