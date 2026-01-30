'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, Plus, Search, Filter, Eye, Edit, Trash2, FileText } from 'lucide-react';
import { formatDate, formatDistanceToNow } from 'date-fns';

/**
 * Writer Articles Page
 *
 * Features:
 * - List User's Articles
 * - Filters (Status, Type, Search)
 * - Actions: Edit, Delete, Submit, Publish (Owner/Admin only).
 */

type Article = {
  id: number;
  title: string;
  status: 'DRAFT' | 'SUBMITTED' | 'READY_FOR_PUBLISH' | 'PUBLISHED' | 'REJECTED' | 'ARCHIVED';
  type: string;
  language: string;
  createdAt: Date;
  updatedAt: Date;
};

export default function WriterArticlesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [articles, setArticles] = useState<Article[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterQ, setFilterQ] = useState<string>('');

  // Load Articles
  useEffect(() => {
    loadArticles();
  }, [page, filterStatus, filterType, filterQ]);

  const loadArticles = async () => {
    setLoading(true);
    try {
      // Endpoint: `GET /api/articles?workspaceId=X&userId=Y...`
      // Assuming `ArticleController` has `GET` with filters.
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
        ...(filterStatus && { status: filterStatus }),
        ...(filterType && { type: filterType }),
        ...(filterQ && { q: filterQ }),
      });

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/articles?${params.toString()}`, {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch articles');
      }

      const data = await response.json();
      setArticles(data.data);
      setTotal(data.total);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return <Badge variant="secondary">Draft</Badge>;
      case 'SUBMITTED':
        return <Badge variant="default">Submitted</Badge>;
      case 'READY_FOR_PUBLISH':
        return <Badge variant="outline" className="bg-blue-100 text-blue-800">Ready</Badge>;
      case 'PUBLISHED':
        return <Badge variant="default" className="bg-green-100 text-green-800">Published</Badge>;
      case 'REJECTED':
        return <Badge variant="destructive">Rejected</Badge>;
      case 'ARCHIVED':
        return <Badge variant="outline">Archived</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">My Articles</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push('/dashboard/writer/articles/new')}
          >
            <Plus className="h-4 w-4 mr-2" />
            New Article
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={loadArticles}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 flex-1">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search articles..."
                value={filterQ}
                onChange={(e) => {
                  setFilterQ(e.target.value);
                  setPage(1);
                }}
                className="w-full"
              />
            </div>

            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All</SelectItem>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="SUBMITTED">Submitted</SelectItem>
                <SelectItem value="READY_FOR_PUBLISH">Ready</SelectItem>
                <SelectItem value="PUBLISHED">Published</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
                <SelectItem value="ARCHIVED">Archived</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All</SelectItem>
                <SelectItem value="POST">Post</SelectItem>
                <SelectItem value="PAGE">Page</SelectItem>
                <SelectItem value="VIDEO">Video</SelectItem>
                <SelectItem value="AUDIO">Audio</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Articles Table */}
      <Card>
        <CardHeader>
          <CardTitle>Articles ({total})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Loading...</div>
          ) : articles.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              No articles found. <Button variant="link" onClick={() => router.push('/dashboard/writer/articles/new')} className="ml-2">Create your first one.</Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Last Updated</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {articles.map((article) => (
                  <TableRow key={article.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="font-bold text-foreground">{article.title}</div>
                        <div className="text-xs text-muted-foreground line-clamp-1">
                          {article.type} / {article.language}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(article.status)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{article.type}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(article.updatedAt, 'PPpp')}
                        <div className="text-xs text-muted-foreground">
                          ({formatDistanceToNow(article.updatedAt, { addSuffix: true })})
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(`/dashboard/writer/articles/${article.id}/edit`)}
                          title="Edit"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        {/* Submit/Review */}
                        {article.status === 'DRAFT' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => router.push(`/dashboard/admin/review?articleId=${article.id}`)} // Assuming review page takes ID
                            title="Submit for Review"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        )}
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
