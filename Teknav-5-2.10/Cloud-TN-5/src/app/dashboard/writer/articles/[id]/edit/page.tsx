'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, Save, FileText, History, CheckCircle, XCircle, Clock, Play, FileEdit, Eye, Type, Keyboard } from 'lucide-react';
import {
  getArticleById,
  updateArticle,
  submitArticle,
  autosaveArticle,
  getAutosave,
  getVersions,
  revertArticle,
} from '@/app/dashboard/writer/_actions/lifecycle';

/**
 * Writer Articles Edit Page (MAXIMIZED)
 *
 * Features:
 * - Real-time Status Badge
 * - Save Button (Manual)
 * - Keyboard Shortcuts (Ctrl+S)
 * - Autosave Engine (Debounced Toast)
 * - Word Count & Read Time
 * - Auto-Excerpt Generator
 * - Submit for Review (Conditional)
 * - Version History Panel (List, Diff Preview, Revert)
 * - Markdown Preview (Simple Regex)
 */

const updateArticleSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  excerpt: z.string().optional(),
  content: z.string().optional(),
});

type FormData = z.infer<typeof updateArticleSchema>;

// Helpers
const calculateWordCount = (text: string): number => {
  if (!text) return 0;
  return text.trim().split(/\s+/).length;
};

const calculateReadTime = (wordCount: number): number => {
  return Math.ceil(wordCount / 200); // Avg 200 wpm
};

const generateExcerpt = (content: string, length = 160): string => {
  if (!content) return '';
  return content.substring(0, length).replace(/\s+$/, '') + '...';
};

// Simple Markdown Parser (Regex) for Preview
const parseMarkdown = (markdown: string): string => {
  if (!markdown) return '';
  let html = markdown
    // Headers
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Lists
    .replace(/^\- (.*$)/gim, '<li>$1</li>')
    .replace(/^\d+\. (.*$)/gim, '<li>$1</li>')
    // Links
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>')
    // Line breaks
    .replace(/\n/g, '<br />');
  
  return `<div class="prose prose-sm max-w-none">${html}</div>`;
};

export default function WriterArticlesEditPage() {
  const params = useParams();
  const articleId = params.id;
  const router = useRouter();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [article, setArticle] = useState<any>(null);
  const [autosaving, setAutosaving] = useState(false);
  const [autosave, setAutosave] = useState<any>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [isVersionsOpen, setIsVersionsOpen] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<any>(null);
  const [isRecoveryOpen, setIsRecoveryOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'write' | 'preview'>('write');

  const form = useForm<FormData>({
    resolver: zodResolver(updateArticleSchema),
    defaultValues: {
      title: '',
      excerpt: '',
      content: '',
    },
  });

  const formValues = form.watch();
  const formValuesRef = useRef(formValues);

  // 1. Load Article
  useEffect(() => {
    loadArticle();
  }, [articleId]);

  const loadArticle = async () => {
    setLoading(true);
    try {
      const data = await getArticleById(articleId as string);
      setArticle(data);
      form.setValue('title', data.title);
      form.setValue('excerpt', data.excerpt || '');
      form.setValue('content', data.content || '');
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to load article', description: error.message });
      router.push('/dashboard/writer/articles');
    } finally {
      setLoading(false);
    }
  };

  // 2. Autosave Logic (Debounced + Toast)
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (article && article.status === 'DRAFT' && (formValues.title || formValues.content)) {
        setAutosaving(true);
        try {
          await autosaveArticle(articleId as string, formValues);
          setAutosave(new Date());
          toast({ title: 'Autosaved' });
        } catch (error: any) {
          console.error('Autosave failed', error);
        } finally {
          setAutosaving(false);
        }
      }
    }, 10000); // 10 seconds debounce

    return () => clearTimeout(timer);
  }, [formValues, article]);

  // 3. Keyboard Shortcuts (Ctrl+S)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleManualSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [article]);

  // 4. Check Recovery on Load
  useEffect(() => {
    if (article) {
      checkRecovery();
    }
  }, [article]);

  const checkRecovery = async () => {
    const saved = await getAutosave(articleId as string);
    if (saved && new Date(saved.updatedAt) > new Date(article.updatedAt)) {
      setIsRecoveryOpen(true);
    }
  };

  const checkRecoveryRef = useCallback(checkRecovery, [articleId, article]);

  // 5. Handle Manual Save
  const handleManualSave = useCallback(async () => {
    if (!article) return;
    setLoading(true);
    try {
      const updated = await updateArticle(articleId as string, formValues);
      setArticle(updated);
      toast({ title: 'Article saved' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to save article', description: error.message });
    } finally {
      setLoading(false);
    }
  }, [article, formValues, toast]);

  // 6. Handle Generate Excerpt
  const handleGenerateExcerpt = () => {
    if (!formValues.content) return;
    const newExcerpt = generateExcerpt(formValues.content);
    form.setValue('excerpt', newExcerpt);
    toast({ title: 'Excerpt generated' });
  };

  // 7. Handle Submit for Review
  const handleSubmit = async () => {
    if (!article) return;
    setLoading(true);
    try {
      const updated = await submitArticle(articleId as string);
      setArticle(updated);
      toast({ title: 'Article submitted for review' });
      router.push('/dashboard/writer/articles');
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to submit article', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  // 8. Load Versions
  const loadVersions = async () => {
    try {
      const data = await getVersions(articleId as string);
      setVersions(data);
      setIsVersionsOpen(true);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to load versions', description: error.message });
    }
  };

  // 9. Handle Revert Version
  const handleRevert = async () => {
    if (!selectedVersion) return;
    setLoading(true);
    try {
      const updated = await revertArticle(articleId as string, selectedVersion.versionNumber.toString());
      setArticle(updated);
      form.setValue('title', updated.title);
      form.setValue('excerpt', updated.excerpt || '');
      form.setValue('content', updated.content || '');
      toast({ title: 'Reverted to version', description: `Version ${selectedVersion.versionNumber}` });
      setIsVersionsOpen(false);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to revert', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  // 10. Handle Recover Autosave
  const handleRecover = async () => {
    if (!autosave) return;
    try {
      const updated = await updateArticle(articleId as string, autosave);
      setArticle(updated);
      form.setValue('title', updated.title);
      form.setValue('excerpt', updated.excerpt || '');
      form.setValue('content', updated.content || '');
      setIsRecoveryOpen(false);
      toast({ title: 'Recovered from autosave' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to recover', description: error.message });
    }
  };

  // 11. Handle Discard Autosave
  const handleDiscard = async () => {
    setIsRecoveryOpen(false);
  };

  // Metrics
  const wordCount = calculateWordCount(formValues.content || '');
  const readTime = calculateReadTime(wordCount);

  // Status Badges
  const getStatusBadge = () => {
    if (!article) return null;

    switch (article.status) {
      case 'DRAFT':
        return <Badge variant="secondary"><FileText className="h-3 w-3 mr-1" />Draft</Badge>;
      case 'SUBMITTED':
        return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />In Review</Badge>;
      case 'APPROVED':
        return <Badge variant="default"><CheckCircle className="h-3 w-3 mr-1" />Approved</Badge>;
      case 'REJECTED':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>;
      case 'SCHEDULED':
        return <Badge variant="outline"><Play className="h-3 w-3 mr-1" />Scheduled</Badge>;
      case 'PUBLISHED':
        return <Badge variant="default"><Play className="h-3 w-3 mr-1" />Published</Badge>;
      default:
        return <Badge>{article.status}</Badge>;
    }
  };

  // Render Diff Preview
  const renderDiff = () => {
    if (!selectedVersion || !article) return null;

    const currentTitle = formValues.title || '';
    const versionTitle = JSON.parse(selectedVersion.snapshot).title || '';
    const currentContent = formValues.content || '';
    const versionContent = JSON.parse(selectedVersion.snapshot).content || '';

    return (
      <div className="space-y-4 text-sm">
        <div>
          <div className="font-bold mb-2">Title Diff</div>
          <div className="grid grid-cols-[20px_1fr] gap-2">
            <span className="text-muted-foreground">-</span>
            <span className="line-through text-muted-foreground">{versionTitle}</span>
            <span className="text-foreground">+</span>
            <span className="text-foreground">{currentTitle}</span>
          </div>
        </div>
        <div>
          <div className="font-bold mb-2">Content Diff (Snippet)</div>
          <div className="grid grid-cols-[20px_1fr] gap-2">
            <span className="text-muted-foreground">-</span>
            <span className="line-through text-muted-foreground truncate max-h-[100px] overflow-hidden">{versionContent.substring(0, 100)}...</span>
            <span className="text-foreground">+</span>
            <span className="text-foreground truncate max-h-[100px] overflow-hidden">{currentContent.substring(0, 100)}...</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold">Edit Article</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground border px-2 py-1 rounded-md bg-muted/20">
            <FileEdit className="h-3 w-3" />
            {wordCount} words · {readTime} min read
            <Keyboard className="h-3 w-3 ml-2 opacity-50" title="Press Ctrl+S to save" />
          </div>
          {article && article.publishedAt && (
            <span className="text-sm text-muted-foreground">
              Published: {new Date(article.publishedAt).toLocaleString()}
            </span>
          )}
          {article && article.updatedAt && (
            <span className="text-sm text-muted-foreground">
              Last saved: {new Date(article.updatedAt).toLocaleString()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {article && article.status === 'REJECTED' && (
            <div className="text-sm text-destructive" title={article.rejectionReason || 'No reason provided'}>
              Rejected: {article.rejectionReason || 'See feedback'}
            </div>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.push('/dashboard/writer/articles')}
          >
            Close
          </Button>
        </div>
      </div>

      {/* Main Editor Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {getStatusBadge()}
              {autosave && (
                <Badge variant="outline" className="text-xs border-dashed">
                  <Clock className="h-3 w-3 mr-1" />
                  Autosaved
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={loadVersions}
                disabled={!article}
                title="View version history"
              >
                <History className="h-4 w-4 mr-2" />
                History
              </Button>
              {autosaving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading && !article ? (
            <div className="py-8 text-center text-muted-foreground">Loading...</div>
          ) : (
            <form onSubmit={form.handleSubmit(handleManualSave)} className="space-y-6">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="write">Write</TabsTrigger>
                  <TabsTrigger value="preview">Preview</TabsTrigger>
                </TabsList>
                
                {/* Tab: Write */}
                <TabsContent value="write" className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">Title</Label>
                    <Input
                      id="title"
                      {...form.register('title')}
                      placeholder="Article title..."
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="excerpt">Excerpt (Optional)</Label>
                    <div className="flex gap-2">
                      <Textarea
                        id="excerpt"
                        {...form.register('excerpt')}
                        placeholder="Short description..."
                        className="min-h-[80px]"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleGenerateExcerpt}
                        title="Auto-generate from content"
                      >
                        <Type className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="content">Content</Label>
                      <span className="text-xs text-muted-foreground">Markdown supported</span>
                    </div>
                    <Textarea
                      id="content"
                      {...form.register('content')}
                      placeholder="Article content..."
                      className="min-h-[400px] font-mono"
                    />
                  </div>

                  <div className="flex justify-between pt-4 border-t">
                    {/* Submit for Review Button (Only if Draft) */}
                    {article && article.status === 'DRAFT' && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={handleSubmit}
                        disabled={loading || autosaving}
                        title="Submit for Manager/Owner review"
                      >
                        <Clock className="h-4 w-4 mr-2" />
                        Submit for Review
                      </Button>
                    )}
                  </div>
                </TabsContent>

                {/* Tab: Preview */}
                <TabsContent value="preview" className="mt-4 min-h-[400px]">
                  {!formValues.content ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      Start typing content to see preview...
                    </div>
                  ) : (
                    <div className="prose prose-sm max-w-none">
                      <h1 className="text-3xl font-bold mb-4">{formValues.title || 'Untitled'}</h1>
                      {formValues.excerpt && (
                        <p className="text-lg text-muted-foreground mb-6 italic">{formValues.excerpt}</p>
                      )}
                      <div dangerouslySetInnerHTML={{ __html: parseMarkdown(formValues.content) }} />
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Versions Panel Dialog */}
      <Dialog open={isVersionsOpen} onOpenChange={setIsVersionsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Version History</DialogTitle>
            <DialogDescription>
              Immutable history of article changes. Reverting creates a NEW version.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[500px] overflow-y-auto space-y-4">
            {versions.length === 0 ? (
              <div className="text-center text-muted-foreground">No versions found.</div>
            ) : (
              <div className="space-y-2">
                {versions.map((v) => (
                  <div
                    key={v.id}
                    className="border rounded-md p-4 hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => setSelectedVersion(v)}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-bold">Version {v.versionNumber}</div>
                        <div className="text-xs text-muted-foreground">
                          By: {v.updatedBy} | {new Date(v.updatedAt).toLocaleString()}
                        </div>
                      </div>
                      {selectedVersion && selectedVersion.id === v.id && (
                        <Badge>Selected</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <div className="flex-1">
              {selectedVersion && renderDiff()}
            </div>
            <Button
              type="button"
              onClick={handleRevert}
              disabled={!selectedVersion || loading}
              title="Create new version from this snapshot"
            >
              <History className="h-4 w-4 mr-2" />
              Revert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recovery Dialog */}
      <Dialog open={isRecoveryOpen} onOpenChange={setIsRecoveryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recover Autosave?</DialogTitle>
            <DialogDescription>
              We found a newer autosave ({autosave ? new Date(autosave.updatedAt).toLocaleString() : 'unknown'}) than your last saved version. Do you want to restore it?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleDiscard}>
              Discard
            </Button>
            <Button type="button" onClick={handleRecover}>
              Recover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
