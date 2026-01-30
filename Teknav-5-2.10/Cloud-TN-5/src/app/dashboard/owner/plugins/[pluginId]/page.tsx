'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowLeft, Edit, Package, Tag, ExternalLink, Clock, Users, Shield, Play, Pause, Trash2, ArrowRight, FileText, Settings } from 'lucide-react';
import { getPluginById, enablePlugin, disablePlugin } from '../_actions/plugin-marketplace-actions';

/**
 * Plugin Detail Page
 * PART 12 - Plugin Platform: "Marketplace + Install/Upgrade/Rollback + Permissions Matrix + Signing Enforcement"
 */

export default function PluginDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { pluginId } = params;
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [plugin, setPlugin] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    if (pluginId) {
      loadPlugin();
    }
  }, [pluginId]);

  const loadPlugin = async () => {
    setLoading(true);
    try {
      const data = await getPluginById(parseInt(pluginId));
      setPlugin(data.data);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleEnable = async () => {
    try {
      await enablePlugin(parseInt(pluginId));
      toast({ title: 'Plugin enabled' });
      await loadPlugin();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  const handleDisable = async () => {
    try {
      await disablePlugin(parseInt(pluginId));
      toast({ title: 'Plugin disabled' });
      await loadPlugin();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Clock className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading plugin details...</p>
        </div>
      </div>
    );
  }

  if (!plugin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center text-muted-foreground">Plugin not found</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push('/dashboard/owner/plugins/marketplace')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{plugin.name}</h1>
            <p className="text-muted-foreground text-sm">
              {plugin.key} • {plugin.type}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={plugin.isEnabled ? 'default' : 'outline'}
            size="sm"
            onClick={plugin.isEnabled ? handleDisable : handleEnable}
          >
            {plugin.isEnabled ? (
              <>
                <Pause className="h-4 w-4 mr-2" />
                Disable
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Enable
              </>
            )}
          </Button>
          <Button variant="outline" size="icon" onClick={() => router.push(`/dashboard/owner/plugins/${pluginId}/edit`)}>
            <Edit className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Plugin Info Card */}
          <Card>
            <CardHeader>
              <CardTitle>Plugin Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Description */}
              <div>
                <div className="text-sm font-medium mb-2">Description</div>
                <p className="text-sm text-muted-foreground">{plugin.description}</p>
              </div>

              {/* Key */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm font-medium mb-2">Plugin Key</div>
                  <code className="text-xs bg-muted px-2 py-1 rounded">{plugin.key}</code>
                </div>
                <div>
                  <div className="text-sm font-medium mb-2">Type</div>
                  <Badge variant="outline">{plugin.type}</Badge>
                </div>
              </div>

              {/* Slot */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm font-medium mb-2">Slot</div>
                  <Badge variant="outline">{plugin.slot}</Badge>
                </div>
                <div>
                  <div className="text-sm font-medium mb-2">Visibility</div>
                  <Badge variant={plugin.visibility === 'PUBLIC' ? 'default' : 'secondary'}>
                    {plugin.visibility}
                  </Badge>
                </div>
              </div>

              {/* Category */}
              <div>
                <div className="text-sm font-medium mb-2">Category</div>
                <Badge variant="outline">{plugin.category?.name || '-'}</Badge>
              </div>

              {/* Tags */}
              {plugin.tags && plugin.tags.length > 0 && (
                <div>
                  <div className="text-sm font-medium mb-2">Tags</div>
                  <div className="flex flex-wrap gap-2">
                    {plugin.tags.map(tag => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        <Tag className="h-3 w-3 mr-1" />
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Latest Version */}
              {plugin.latestVersion && (
                <div>
                  <div className="text-sm font-medium mb-2">Latest Version</div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium">
                      {plugin.latestVersion.version}
                    </span>
                    {plugin.latestVersion.signingVerified && (
                      <Shield className="h-4 w-4 text-green-500" title="Signed" />
                    )}
                    {plugin.latestVersion.isDeprecated && (
                      <Badge variant="destructive" className="text-xs">Deprecated</Badge>
                    )}
                  </div>
                </div>
              )}

              {/* Installs */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm font-medium mb-2">Installs</div>
                  <div className="text-2xl font-bold">{plugin.installs || 0}</div>
                </div>
                <div>
                  <div className="text-sm font-medium mb-2">Created</div>
                  <div className="text-sm text-muted-foreground">
                    {new Date(plugin.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-4 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(`/dashboard/owner/plugins/${pluginId}/installations`)}
                >
                  <Users className="h-4 w-4 mr-2" />
                  View Installations
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(`/dashboard/owner/plugins/${pluginId}/versions`)}
                >
                  <Package className="h-4 w-4 mr-2" />
                  View Versions
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(`/dashboard/owner/plugins/${pluginId}/permissions`)}
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Permissions
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Manifest Card */}
          {plugin.manifest && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Manifest
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px] w-full border rounded-md p-4">
                  <pre className="text-xs">
                    {JSON.stringify(plugin.manifest, null, 2)}
                  </pre>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column: Quick Actions */}
        <div className="space-y-4">
          {/* Status Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Enabled</span>
                <Badge variant={plugin.isEnabled ? 'default' : 'secondary'}>
                  {plugin.isEnabled ? 'Yes' : 'No'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Visibility</span>
                <Badge variant="outline">{plugin.visibility}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Latest Version</span>
                <span className="text-sm font-mono">
                  {plugin.latestVersion?.version || '-'}
                </span>
              </div>
              {plugin.latestVersion?.signingVerified && (
                <div className="flex items-center justify-between">
                  <span className="text-sm">Signed</span>
                  <Check className="h-4 w-4 text-green-500" />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => router.push(`/dashboard/owner/plugins/${pluginId}/versions`)}
              >
                <Package className="h-4 w-4 mr-2" />
                Manage Versions
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => router.push(`/dashboard/owner/plugins/${pluginId}/permissions`)}
              >
                <Settings className="h-4 w-4 mr-2" />
                Manage Permissions
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => router.push(`/dashboard/owner/plugins/${pluginId}/installations`)}
              >
                <Users className="h-4 w-4 mr-2" />
                Manage Installations
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => router.push('/dashboard/owner/plugins/marketplace')}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Back to Marketplace
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Plugin Overview</CardTitle>
              <CardDescription>General plugin information and settings</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold mb-2">{plugin.name}</h3>
                  <p className="text-muted-foreground">{plugin.description}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-medium">Type</div>
                    <div className="text-sm">{plugin.type}</div>
                  </div>
                  <div>
                    <div className="text-sm font-medium">Slot</div>
                    <div className="text-sm">{plugin.slot}</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {plugin.tags && plugin.tags.map(tag => (
                    <Badge key={tag} variant="secondary">{tag}</Badge>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-4 border-t">
                  <div>
                    <div className="text-sm font-medium">Created</div>
                    <div className="text-sm text-muted-foreground">
                      {new Date(plugin.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => router.push(`/dashboard/owner/plugins/${pluginId}/versions/new`)}
                  >
                    <Package className="h-4 w-4 mr-2" />
                    Upload New Version
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="versions" className="mt-6">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Versions</CardTitle>
              <Button
                variant="default"
                size="sm"
                onClick={() => router.push(`/dashboard/owner/plugins/${pluginId}/versions/new`)}
              >
                <Package className="h-4 w-4 mr-2" />
                Upload Version
              </Button>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                <div className="text-sm">Manage plugin versions</div>
                <div className="text-xs mt-2">
                  View, upload, promote, deprecate, and rollback versions
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => router.push(`/dashboard/owner/plugins/${pluginId}/versions`)}
                >
                  <ArrowRight className="h-4 w-4 mr-2" />
                  Go to Versions Page
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="permissions" className="mt-6">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Permissions</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/dashboard/owner/plugins/${pluginId}/permissions`)}
              >
                <Settings className="h-4 w-4 mr-2" />
                Manage Permissions
              </Button>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                <div className="text-sm">Manage plugin permissions</div>
                <div className="text-xs mt-2">
                  Configure global permissions (per scope) for all workspaces
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => router.push(`/dashboard/owner/plugins/${pluginId}/permissions`)}
                >
                  <ArrowRight className="h-4 w-4 mr-2" />
                  Go to Permissions Page
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="mt-6">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Execution Logs</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/dashboard/owner/plugins/${pluginId}/logs`)}
              >
                <FileText className="h-4 w-4 mr-2" />
                View Logs
              </Button>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                <div className="text-sm">Plugin Execution Logs</div>
                <div className="text-xs mt-2">
                  View and search plugin execution logs across all workspaces
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => router.push(`/dashboard/owner/plugins/${pluginId}/logs`)}
                >
                  <ArrowRight className="h-4 w-4 mr-2" />
                  Go to Logs Page
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
