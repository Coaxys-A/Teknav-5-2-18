'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { 
  Save, Eye, Trash2, RotateCw, History, 
  Bot, Send, Sparkles, FileImage, LayoutTemplate, 
  Languages, Clock, Lock, Unlock 
} from 'lucide-react';
import { 
  getArticle, updateArticle, autosaveDraft, 
  submitForReview, approveArticle, rejectArticle, 
  publishArticle, unpublishArticle, 
  getTemplates 
} from './_actions/editor';
import { formatDate, formatDistanceToNow } from 'date-fns';
import { useEventStream } from '@/hooks/use-event-stream'; // Custom hook for SSE

/**
 * Advanced Article Editor Page (3-Pane Layout)
 *
 * Layout:
 * - Left: Outline + Templates + Translations + Media
 * - Center: Rich Editor (MVP: Textarea)
 * - Right: AI Sidebar (Chat + Streaming)
 *
 * Features:
 * - Autosave (Redis Draft + Debounced)
 * - Locking (ReadOnly mode)
 * - Versioning (Revert)
 * - AI Streaming (SSE)
 * - Templates (Apply)
 * - Translations (Matrix)
 * - Media (Upload + Alt-Text)
 */

export default function EditorPage() {
  const router = useRouter();
  const { id } = useParams();
  const { toast } = useToast();
  
  // State
  const [loading, setLoading] = useState(false);
  const [article, setArticle] = useState<any>(null);
  const [draft, setDraft] = useState<any>(null);
  const [autosaveStatus, setAutosaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [aiMessage, setAiMessage] = useState('');
  const [isAiStreaming, setIsAiStreaming] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [lockOwner, setLockOwner] = useState('');
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [showMediaModal, setShowMediaModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'editor' | 'templates' | 'translations' | 'media'>('editor');

  // Refs
  const autosaveTimeoutRef = useRef<NodeJS.Timeout>();
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // 1. Fetch Article (SSR Hydration)
  useEffect(() => {
    if (id) loadArticle(id);
  }, [id]);

  // 2. Autosave Logic (Debounced)
  const handleAutosave = async (content: string, title: string) => {
    setAutosaveStatus('saving');
    
    try {
      // A. Save to Redis (Backend `ArticleService.autosaveDraft`)
      await autosaveDraft(id as string, { title, content }); // Server action
      
      // B. Set local state (Draft)
      setDraft({ title, content, updatedAt: new Date() });
      
      setAutosaveStatus('saved');
    } catch (error: any) {
      setAutosaveStatus('error');
      toast({ variant: 'destructive', title: 'Autosave failed', description: error.message });
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const content = e.target.value;
    const title = article?.title || ''; // Title input not shown for brevity, but assume exists

    // Debounce
    clearTimeout(autosaveTimeoutRef.current);
    autosaveTimeoutRef.current = setTimeout(() => {
      handleAutosave(content, title);
    }, 2000); // 2s

    // Update State (Optimistic)
    setArticle(prev => prev ? { ...prev, content } : null);
  };

  // 3. AI Sidebar Actions
  const handleAiTool = async (tool: string, selectionRange?: { start: number; end: number }) => {
    setAiMessage(`Generating ${tool}...`);
    setIsAiStreaming(true);

    try {
      // Enqueue AI Job (Backend `AiChatService.executeTool`)
      const result = await fetch(`/api/articles/${id}/ai/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4',
          tool,
          instructions: aiMessage,
          selectionRange,
        }),
        credentials: 'include',
      });

      if (!result.ok) throw new Error('AI request failed');
      
      // Handle Streaming Response (SSE Logic)
      // For MVP, we assume response is JSON.
      // In real app, we'd hook into `OpenRouterService.stream`.
      const data = await result.json();
      
      // Apply Change
      if (data.content) {
        setArticle(prev => prev ? { ...prev, content: data.content } : null);
        handleAutosave(data.content, article.title);
      }

      setAiMessage('');
      setIsAiStreaming(false);
    } catch (error: any) {
      setAiMessage('Error: ' + error.message);
      setIsAiStreaming(false);
      toast({ variant: 'destructive', title: 'AI failed', description: error.message });
    }
  };

  // 4. Template Action (Apply)
  const handleApplyTemplate = async (templateId: string) => {
    try {
      // Call Backend `PageTemplateService.applyTemplate`
      const response = await fetch(`/api/templates/article/${templateId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: {
            title: article?.title,
            mainKeyword: 'AI',
            audience: 'General',
          },
        }),
        credentials: 'include',
      });

      if (!response.ok) throw new Error('Failed to apply template');

      const data = await response.json();
      setArticle(prev => prev ? { ...prev, content: data.content } : null);
      handleAutosave(data.content, article?.title || '');
      setShowTemplateModal(false);
      toast({ title: 'Template applied' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Template failed', description: error.message });
    }
  };

  // 5. Media Actions
  const handleInsertImage = (url: string) => {
    // Markdown image insert
    const mdImage = `
![Image](${url})
`;
    
    const newContent = (editorRef.current?.value || '') + mdImage;
    if (editorRef.current) {
      editorRef.current.value = newContent;
      handleChange({ target: editorRef.current } as React.ChangeEvent<HTMLTextAreaElement>);
    }
  };

  // 6. Lifecycle Actions
  const handleSubmitForReview = async () => {
    if (!confirm('Submit for review?')) return;
    try {
      await submitForReview(id as string);
      router.push('/dashboard/writer/articles');
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to submit', description: error.message });
    }
  };

  const handlePublish = async () => {
    if (!confirm('Publish now?')) return;
    try {
      await publishArticle(id as string);
      router.push('/dashboard/writer/articles');
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to publish', description: error.message });
    }
  };

  const loadArticle = async (id: string) => {
    setLoading(true);
    try {
      const data = await getArticle(id);
      setArticle(data);
      
      // Check Lock (Backend `ArticleAutosaveService.checkLock`)
      const lock = await fetch(`/api/articles/${id}/lock`).then(r => r.json()); // Endpoint stubbed
      if (lock) {
        setIsLocked(true);
        setLockOwner(lock.userId);
        toast({ title: 'Article is locked by another user', description: 'Read-only mode' });
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to load article', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  // SSE Listener (Realtime Collaboration)
  useEventStream('teknav:articles:events', (event: any) => {
    if (event.id === parseInt(id as string)) {
      if (event.type === 'article.autosaved') {
        // Update Draft Indicator
        setAutosaveStatus('saved');
      } else if (event.type === 'article.published') {
        toast({ title: 'Article published!', description: 'Redirecting...' });
        setTimeout(() => router.push('/dashboard/writer/articles'), 1000);
      }
    }
  });

  return (
    <div className="h-[calc(100vh-64px)] overflow-hidden flex flex-col">
      {/* Header */}
      <header className="h-14 border-b flex items-center justify-between px-4 bg-background">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold truncate max-w-[200px]">{article?.title || 'New Article'}</h1>
          <Badge variant={article?.status === 'PUBLISHED' ? 'default' : 'secondary'}>
            {article?.status}
          </Badge>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>Auto-saved {autosaveStatus === 'saving' ? '...' : ''}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isLocked && <Lock className="h-4 w-4 text-orange-500" />}
          <Button variant="outline" size="sm" onClick={() => setShowVersionModal(true)}>
            <History className="h-4 w-4 mr-2" />
            Versions
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowMediaModal(true)}>
            <FileImage className="h-4 w-4 mr-2" />
            Media
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowTemplateModal(true)}>
            <LayoutTemplate className="h-4 w-4 mr-2" />
            Templates
          </Button>
          <Button variant="secondary" size="sm" onClick={handleSubmitForReview}>
            <Eye className="h-4 w-4 mr-2" />
            Submit for Review
          </Button>
          <Button variant="default" size="sm" onClick={handlePublish}>
            <Send className="h-4 w-4 mr-2" />
            Publish
          </Button>
        </div>
      </header>

      {/* Main Content (3-Pane Layout) */}
      <main className="flex-1 overflow-hidden flex">
        
        {/* Pane 1: Left (Outline, Templates, Translations, Media) */}
        <aside className="w-64 border-r bg-muted/10 flex flex-col overflow-hidden">
          <Tabs defaultValue="editor" className="h-full flex flex-col" orientation="horizontal">
            {/* Tab Headers */}
            <div className="flex-1 flex items-center justify-around px-2 py-2 border-b bg-background">
              <button 
                onClick={() => setActiveTab('editor')} 
                className={`flex-1 text-xs font-medium ${activeTab === 'editor' ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                <Bot className="h-3 w-3 mr-1 inline" /> Editor
              </button>
              <button 
                onClick={() => setActiveTab('templates')} 
                className={`flex-1 text-xs font-medium ${activeTab === 'templates' ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                <LayoutTemplate className="h-3 w-3 mr-1 inline" /> Templates
              </button>
              <button 
                onClick={() => setActiveTab('translations')} 
                className={`flex-1 text-xs font-medium ${activeTab === 'translations' ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                <Languages className="h-3 w-3 mr-1 inline" /> Translations
              </button>
              <button 
                onClick={() => setActiveTab('media')} 
                className={`flex-1 text-xs font-medium ${activeTab === 'media' ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                <FileImage className="h-3 w-3 mr-1 inline" /> Media
              </button>
            </div>

            {/* Tab Content: Editor Tools (Placeholder) */}
            {activeTab === 'editor' && (
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                  <h3 className="text-sm font-medium">AI Tools</h3>
                  <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => handleAiTool('rewrite')}>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Rewrite Selection
                  </Button>
                  <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => handleAiTool('improve_seo')}>
                    <Bot className="h-4 w-4 mr-2" />
                    Improve SEO
                  </Button>
                  <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => handleAiTool('translate_section')}>
                    <Languages className="h-4 w-4 mr-2" />
                    Translate Section
                  </Button>
                </div>
              </ScrollArea>
            )}
          </Tabs>
        </aside>

        {/* Pane 2: Center (Rich Editor) */}
        <section className="flex-1 flex flex-col bg-background">
          <Textarea
            ref={editorRef}
            className="flex-1 resize-none focus:outline-none p-8 font-serif text-lg leading-relaxed border-none shadow-none"
            placeholder="Start typing here..."
            value={article?.content}
            onChange={handleChange}
            disabled={isLocked}
          />
        </section>

        {/* Pane 3: Right (AI Chat + Streaming) */}
        <aside className="w-80 border-l bg-muted/5 flex flex-col overflow-hidden">
          <div className="p-3 border-b flex items-center justify-between">
            <span className="text-sm font-bold">AI Assistant</span>
            <Select value="gpt-4" className="text-xs">
              <SelectTrigger className="w-[100px] h-7">
                <SelectValue placeholder="Model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gpt-4">GPT-4</SelectItem>
                <SelectItem value="gpt-3.5">GPT-3.5</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ScrollArea className="flex-1 p-4 space-y-4">
            {/* Chat History (Stubbed) */}
            {isAiStreaming && (
              <div className="flex items-start gap-2 animate-pulse">
                <Bot className="h-4 w-4 text-primary" />
                <div className="text-sm text-muted-foreground">Thinking...</div>
              </div>
            )}
            {aiMessage && (
              <div className="flex items-start gap-2 bg-secondary/20 p-2 rounded-md">
                <Bot className="h-4 w-4 text-primary" />
                <div className="text-sm">{aiMessage}</div>
              </div>
            )}
          </ScrollArea>
          <div className="p-3 border-t">
            <Input
              placeholder="Ask AI something..."
              className="text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  // Handle Chat Message
                  setAiMessage(e.currentTarget.value);
                  // Call Backend `AiChatService.sendMessage`
                }
              }}
            />
            <Button className="mt-2 w-full" variant="secondary" size="sm">
              <Send className="h-4 w-4 mr-2" />
              Send
            </Button>
          </div>
        </aside>

      </main>

      {/* Version Modal */}
      <Dialog open={showVersionModal} onOpenChange={setShowVersionModal}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Article History</DialogTitle>
            <DialogDescription>
              Revert to a previous version or create a new snapshot.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Current: v{article?.versions?.length || 1} ({formatDate(article?.updatedAt, 'PPpp')})
            </div>
            {/* Version List */}
            <div className="max-h-[200px] overflow-y-auto space-y-2">
              {article?.versions?.map((v: any) => (
                <div key={v.id} className="flex items-center justify-between p-2 border rounded-md">
                  <div className="flex flex-col">
                    <span className="text-xs font-medium">v{v.id}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(v.createdAt, { addSuffix: true })}
                    </span>
                  </div>
                  <Button size="icon" variant="outline" title="Revert to this version">
                    <RotateCw className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowVersionModal(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Media Modal */}
      <Dialog open={showMediaModal} onOpenChange={setShowMediaModal}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Media Library</DialogTitle>
          </DialogHeader>
          <div className="h-[400px] flex flex-col items-center justify-center text-muted-foreground">
            {/* Media List (Stubbed) */}
            <div className="flex items-center gap-4">
              <FileImage className="h-8 w-8 opacity-50" />
              <span>Upload and organize your assets.</span>
            </div>
            <div className="text-xs mt-2">
              (Stubbed for MVP)
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Template Modal */}
      <Dialog open={showTemplateModal} onOpenChange={setShowTemplateModal}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Templates</DialogTitle>
          </DialogHeader>
          <div className="h-[300px] flex flex-col items-center justify-center text-muted-foreground">
            <div className="flex items-center gap-4">
              <LayoutTemplate className="h-8 w-8 opacity-50" />
              <span>Select a template to apply structure.</span>
            </div>
            <div className="text-xs mt-2">
              (Stubbed for MVP)
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
