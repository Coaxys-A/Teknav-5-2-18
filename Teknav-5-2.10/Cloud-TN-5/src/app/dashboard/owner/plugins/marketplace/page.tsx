'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Search, Filter, Plus, ArrowUpDown, FileText, Tag, ExternalLink, Check } from 'lucide-react';
import { getMarketplacePlugins } from './_actions/plugin-marketplace-actions';

/**
 * Plugin Marketplace Page
 * PART 12 - Plugin Platform: "Marketplace + Install/Upgrade/Rollback + Permissions Matrix + Signing Enforcement + WASM Sandbox Hardening + Event Pipelines + Rate Limits + Logs + Analytics Attribution"
 */

type Plugin = {
  id: number;
  key: string;
  name: string;
  description: string;
  slot: string;
  type: string;
  tags: string[];
  visibility: 'PUBLIC' | 'PRIVATE';
  isEnabled: boolean;
  categoryId: number;
  installs: number;
  createdAt: string;
  updatedAt: string;
  latestVersion?: {
    id: number;
    version: string;
    signingVerified: boolean;
  };
  category?: {
    id: number;
    name: string;
    icon?: string;
  };
};

type MarketplaceFilter = {
  q?: string;
  categoryId?: number;
  tags?: string[];
  visibility?: 'PUBLIC' | 'PRIVATE';
  isEnabled?: boolean;
  sort?: 'name' | 'createdAt' | 'installs';
};

export default function PluginMarketplacePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedFilters, setSelectedFilters] = useState<MarketplaceFilter>({});
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Initialize from URL params
  useEffect(() => {
    const q = searchParams.get('q') || '';
    const categoryId = searchParams.get('categoryId') ? parseInt(searchParams.get('categoryId')!) : undefined;
    const visibility = searchParams.get('visibility') as 'PUBLIC' | 'PRIVATE' | undefined;
    const isEnabled = searchParams.get('isEnabled') === 'true' ? true : searchParams.get('isEnabled') === 'false' ? false : undefined;
    const sort = searchParams.get('sort') as MarketplaceFilter['sort'] || undefined;
    const tags = searchParams.get('tags')?.split(',') || undefined;

    setSearchQuery(q);
    setSelectedFilters({
      q: q || undefined,
      categoryId,
      visibility,
      isEnabled,
      sort,
      tags,
    });

    if (tags) {
      setSelectedTags(tags);
    }
  }, [searchParams]);

  // Load plugins on filter change
  useEffect(() => {
    loadPlugins();
  }, [selectedFilters, page, pageSize]);

  // Load categories
  useEffect(() => {
    loadCategories();
  }, []);

  const loadPlugins = async () => {
    setLoading(true);
    try {
      const data = await getMarketplacePlugins({
        ...selectedFilters,
        page,
        pageSize,
      });

      setPlugins(data.data);
      setTotal(data.total);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      // In production, this would fetch from backend
      // For now, we'll use mock categories
      setCategories([
        { id: 1, name: 'CMS' },
        { id: 2, name: 'AI' },
        { id: 3, name: 'Analytics' },
        { id: 4, name: 'Communication' },
        { id: 5, name: 'Workflow' },
        { id: 6, name: 'Utilities' },
      ]);
    } catch (error: any) {
      console.error('Failed to load categories:', error);
    }
  };

  const handleSearch = (q: string) => {
    setPage(1);
    setSelectedFilters({ ...selectedFilters, q: q || undefined });
  };

  const handleFilterChange = (filterKey: string, value: any) => {
    setPage(1);
    setSelectedFilters({ ...selectedFilters, [filterKey]: value });
  };

  const handleSortChange = (sort: MarketplaceFilter['sort']) => {
    setPage(1);
    setSelectedFilters({ ...selectedFilters, sort });
  };

  const handleTagToggle = (tag: string) => {
    setPage(1);
    const newTags = selectedTags.includes(tag)
      ? selectedTags.filter(t => t !== tag)
      : [...selectedTags, tag];

    setSelectedTags(newTags);
    setSelectedFilters({ ...selectedFilters, tags: newTags.length > 0 ? newTags : undefined });
  };

  const handleResetFilters = () => {
    setPage(1);
    setSearchQuery('');
    setSelectedTags([]);
    setSelectedFilters({});
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push('/dashboard/owner/plugins')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Plugin Marketplace</h1>
            <p className="text-muted-foreground text-sm">Browse, install, and manage plugins</p>
          </div>
        </div>
        <Button onClick={() => router.push('/dashboard/owner/plugins/new')}>
          <Plus className="h-4 w-4 mr-2" />
          Create Plugin
        </Button>
      </div>

      {/* Filters & Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Search */}
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search plugins by name, key, or description..."
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Filters */}
            <div className="flex gap-2 flex-1">
              <Select
                value={selectedFilters.categoryId?.toString() || 'all'}
                onValueChange={(value) => handleFilterChange('categoryId', value === 'all' ? undefined : parseInt(value))}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map(category => (
                    <SelectItem key={category.id} value={category.id.toString()}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={selectedFilters.visibility || 'all'}
                onValueChange={(value) => handleFilterChange('visibility', value === 'all' ? undefined : value)}
              >
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Visibility" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Visibility</SelectItem>
                  <SelectItem value="PUBLIC">Public</SelectItem>
                  <SelectItem value="PRIVATE">Private</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={selectedFilters.isEnabled === true ? 'true' : selectedFilters.isEnabled === false ? 'false' : 'all'}
                onValueChange={(value) => handleFilterChange('isEnabled', value === 'all' ? undefined : value === 'true')}
              >
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="true">Enabled</SelectItem>
                  <SelectItem value="false">Disabled</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={selectedFilters.sort || 'createdAt'}
                onValueChange={(value) => handleSortChange(value as MarketplaceFilter['sort'])}
              >
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Sort By" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="createdAt">Created At</SelectItem>
                  <SelectItem value="installs">Installs</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Tags */}
          {selectedTags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {selectedTags.map(tag => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="cursor-pointer hover:bg-secondary/80"
                  onClick={() => handleTagToggle(tag)}
                >
                  <Tag className="h-3 w-3 mr-1" />
                  {tag}
                  <Check className="h-3 w-3 ml-1" />
                </Badge>
              ))}
            </div>
          )}

          {/* Reset Filters */}
          {(searchQuery || selectedFilters.categoryId || selectedFilters.visibility || selectedFilters.isEnabled !== undefined || selectedFilters.sort || selectedTags.length > 0) && (
            <div className="flex justify-between items-center mt-4">
              <div className="text-sm text-muted-foreground">
                {total} plugin{total !== 1 ? 's' : ''} found
              </div>
              <Button variant="ghost" size="sm" onClick={handleResetFilters}>
                Reset Filters
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Plugins Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">
              Loading plugins...
            </div>
          ) : plugins.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No plugins found. Try adjusting your filters or create a new plugin.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]"> </TableHead>
                  <TableHead>Plugin</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Installs</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[50px]"> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plugins.map(plugin => (
                  <TableRow
                    key={plugin.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => router.push(`/dashboard/owner/plugins/${plugin.id}`)}
                  >
                    <TableCell>
                      <Button variant="ghost" size="icon">
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-blue-500" />
                        <div>
                          <div className="font-medium">{plugin.name}</div>
                          <div className="text-xs text-muted-foreground line-clamp-1 max-w-[200px]">
                            {plugin.description}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {plugin.key}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{plugin.type}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{plugin.category?.name || '-'}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-xs">
                          {plugin.latestVersion?.version || '-'}
                        </span>
                        {plugin.latestVersion?.signingVerified && (
                          <Check className="h-3 w-3 text-green-500" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{plugin.installs}</TableCell>
                    <TableCell>
                      <Badge
                        variant={plugin.isEnabled ? 'default' : 'secondary'}
                        className={plugin.isEnabled ? 'bg-green-500' : ''}
                      >
                        {plugin.isEnabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {new Date(plugin.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon">
                        <ArrowRight className="h-4 w-4" />
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
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {Math.min((page - 1) * pageSize + 1, total)} to {Math.min(page * pageSize, total)} of {total}
          </div>
          <div className="flex gap-2">
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
        </div>
      )}
    </div>
  );
}
