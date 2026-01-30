'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Send, Trash2, User, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { formatDate, formatDistanceToNow } from 'date-fns';
import { useEventStream } from '@/hooks/use-event-stream'; // Custom hook

/**
 * Comments Tab Component
 * M2 Milestone: "Workflow + collaboration (publisher-grade)"
 * 
 * Features:
 * - List Comments (Article/Version scoped)
 * - Add Comment
 * - Resolve Comment
 */

type Comment = {
  id: number;
  body: string;
  status: 'ACTIVE' | 'RESOLVED' | 'DELETED';
  createdAt: Date;
  user: { id: number; name: string; email: string; avatar: string };
};

export default function CommentsTab({ articleId, versionId }: { articleId: number; versionId: number }) {
  const [loading, setLoading] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'resolved'>('all');

  // Fetch Comments
  useEffect(() => {
    loadComments();
  }, [articleId, versionId]);

  // SSE Listener (Realtime)
  useEventStream('workflow.comment.created', (event: any) => {
    if (event.articleId === articleId) {
      setComments(prev => [event, ...prev]);
    }
  });

  useEventStream('workflow.comment.resolved', (event: any) => {
    if (event.articleId === articleId) {
      setComments(prev => prev.map(c => c.id === event.id ? event : c));
    }
  });

  useEventStream('workflow.comment.deleted', (event: any) => {
    if (event.articleId === articleId) {
      setComments(prev => prev.filter(c => c.id !== event.id));
    }
  });

  const loadComments = async () => {
    setLoading(true);
    try {
      // Call Backend `WorkflowCommentService.getComments`
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/workflow/comments?articleId=${articleId}&versionId=${versionId}`, {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to load comments');
      }

      const data = await response.json();
      setComments(data.data);
    } catch (error: any) {
      console.error('Failed to load comments', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/workflow/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleId,
          versionId,
          body: newComment,
        }),
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to add comment');
      }

      setNewComment('');
      // SSE Event (workflow.comment.created) will add to list
    } catch (error: any) {
      console.error('Failed to add comment', error);
    }
  };

  const handleResolve = async (commentId: number) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/workflow/comments/${commentId}/resolve`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to resolve comment');
      }

      // SSE Event (workflow.comment.resolved) will update list
    } catch (error: any) {
      console.error('Failed to resolve comment', error);
    }
  };

  const handleDelete = async (commentId: number) => {
    if (!confirm('Delete this comment?')) return;

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/workflow/comments/${commentId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to delete comment');
      }

      // SSE Event (workflow.comment.deleted) will remove from list
    } catch (error: any) {
      console.error('Failed to delete comment', error);
    }
  };

  const filteredComments = comments.filter(c => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'active') return c.status === 'ACTIVE';
    if (filterStatus === 'resolved') return c.status === 'RESOLVED';
    return c.status !== 'DELETED';
  });

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 p-3 border-b">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold">Discussion</h2>
          <div className="flex items-center gap-2">
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-7 text-xs w-[100px]">
                <SelectValue placeholder="Filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
            {loading && <div className="h-4 w-4 border-2 border-primary border-t-transparent animate-spin rounded-full" />}
          </div>
        </div>
        <Textarea
          placeholder="Add a comment..."
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          className="resize-none h-20"
        />
        <div className="flex justify-end mt-2">
          <Button size="sm" onClick={handleAddComment} disabled={!newComment.trim()}>
            <Send className="h-4 w-4 mr-2" />
            Comment
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1 p-2 space-y-4">
        {filteredComments.length === 0 && (
          <div className="text-center text-muted-foreground text-sm pt-4">
            No comments yet. Start to discussion!
          </div>
        )}
        {filteredComments.map((comment) => (
          <div key={comment.id} className="flex gap-3 p-3 border rounded-md bg-background">
            {/* Avatar */}
            <div className="flex-shrink-0">
              <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold">
                {comment.user.name.charAt(0).toUpperCase()}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{comment.user.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">
                    {formatDistanceToNow(comment.createdAt, { addSuffix: true })}
                  </span>
                  <Badge variant={comment.status === 'RESOLVED' ? 'secondary' : 'outline'} className="text-[10px]">
                    {comment.status}
                  </Badge>
                </div>
              </div>
              <p className="text-sm text-foreground break-words">
                {comment.body}
              </p>
              {comment.status === 'RESOLVED' && (
                <div className="flex items-center gap-1 text-xs text-green-700 bg-green-100 px-2 py-1 rounded w-fit">
                  <CheckCircle2 className="h-3 w-3" />
                  Resolved
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col items-start gap-2">
              {comment.status === 'ACTIVE' && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => handleResolve(comment.id)}
                  title="Resolve"
                >
                  <AlertTriangle className="h-3 w-3" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                onClick={() => handleDelete(comment.id)}
                title="Delete"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </ScrollArea>
    </div>
  );
}
