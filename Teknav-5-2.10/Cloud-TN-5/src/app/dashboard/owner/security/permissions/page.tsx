'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { RefreshCw, Save, Shield, User, Globe, X, CheckCircle, AlertTriangle } from 'lucide-react';
import { getDefaultPermissions, setTenantPermissions, setWorkspacePermissions, resetPermissions } from './_actions/permissions';
import { Breadcrumbs } from '@/components/shared/breadcrumbs';
import { ZodError } from 'zod';

/**
 * Owner Security Permissions Page
 *
 * Features:
 * - Permission Matrix View (Roles x Resources)
 * - Toggle Allow/Deny per action
 * - Diff Viewer
 * - Save Tenant/Workspace Overlays
 * - Reset Overlays
 */

type Permission = {
  action: string;
  resource: string;
  effect: 'allow' | 'deny';
};

export default function OwnerPermissionsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [defaultPermissions, setDefaultPermissions] = useState<any>({});
  const [tenantOverlay, setTenantOverlay] = useState<any>({});
  const [workspaceOverlay, setWorkspaceOverlay] = useState<any>({});
  const [activeTab, setActiveTab] = useState<'tenant' | 'workspace'>('tenant');
  const [activeRole, setActiveRole] = useState<string>('ADMIN');

  // Load Default Permissions
  useEffect(() => {
    loadDefaults();
  }, []);

  const loadDefaults = async () => {
    setLoading(true);
    try {
      const data = await getDefaultPermissions();
      setDefaultPermissions(data);
      setTenantOverlay(data.tenantOverride || {});
      setWorkspaceOverlay(data.workspaceOverride || {});
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  // Save Tenant
  const handleSaveTenant = async (tenantId: number, permissions: any) => {
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('permissions', JSON.stringify(permissions));
      await setTenantPermissions(tenantId.toString(), formData);
      toast({ title: 'Tenant permissions saved' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to save', description: error.message });
    } finally {
      setSaving(false);
    }
  };

  // Save Workspace
  const handleSaveWorkspace = async (workspaceId: number, permissions: any) => {
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('permissions', JSON.stringify(permissions));
      await setWorkspacePermissions(workspaceId.toString(), formData);
      toast({ title: 'Workspace permissions saved' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to save', description: error.message });
    } finally {
      setSaving(false);
    }
  };

  // Reset
  const handleReset = async () => {
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('tenantId', '1'); // Default tenant
      formData.append('workspaceId', '1'); // Default workspace
      await resetPermissions(formData);
      toast({ title: 'Permissions reset' });
      loadDefaults();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to reset', description: error.message });
    } finally {
      setSaving(false);
    }
  };

  // Permission Matrix View (Simplified)
  const renderMatrix = (matrix: any, isEditable: boolean, onSave: (perms: any) => void) => {
    const roles = ['OWNER', 'ADMIN', 'EDITOR', 'WRITER'];
    const actions = ['CREATE', 'READ', 'UPDATE', 'DELETE', 'PUBLISH', 'APPROVE', 'MANAGE'];

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">Permission Matrix</h3>
          {isEditable && (
            <Button onClick={() => onSave(matrix)} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              Save
            </Button>
          )}
        </div>
        <Table className="border">
          <TableHeader>
            <TableRow>
              <TableHead>Action</TableHead>
              {roles.map(role => (
                <TableHead key={role} className="text-xs">{role}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {actions.map(action => (
              <TableRow key={action}>
                <TableCell className="font-mono text-xs">{action}</TableCell>
                {roles.map(role => {
                  const key = `${role}_${action}`;
                  const isAllowed = matrix[key]; // Assumes flat key structure
                  return (
                    <TableCell key={role} className="text-center">
                      {isEditable ? (
                        <Switch
                          checked={isAllowed || false}
                          onCheckedChange={(checked) => {
                            const newMatrix = { ...matrix };
                            newMatrix[key] = checked;
                            onSave(newMatrix);
                          }}
                        />
                      ) : (
                        <Badge variant={isAllowed ? 'default' : 'secondary'}>
                          {isAllowed ? 'Allow' : 'Deny'}
                        </Badge>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  const breadcrumbs = [
    { label: 'Owner', href: '/dashboard/owner' },
    { label: 'Security', href: '/dashboard/owner/security' },
    { label: 'Permissions', href: '/dashboard/owner/security/permissions' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Security Permissions</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={loadDefaults}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleReset}
            title="Reset All Overlays"
          >
            <X className="h-4 w-4 mr-2" />
            Reset
          </Button>
        </div>
      </div>

      <Breadcrumbs items={breadcrumbs} />

      {/* Info Alert */}
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Manage Permissions</AlertTitle>
        <AlertDescription>
          Permissions can be overridden at Tenant or Workspace level. 
          Workspace overrides take precedence over Tenant overrides.
        </AlertDescription>
      </Alert>

      {/* Main Content */}
      <Card>
        <CardHeader>
          <CardTitle>Permission Matrix</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="tenant">Tenant Overlay</TabsTrigger>
              <TabsTrigger value="workspace">Workspace Overlay</TabsTrigger>
            </TabsList>
            
            {/* Tab: Tenant */}
            <TabsContent value="tenant" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Applies to all workspaces in this tenant.
                </div>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => handleSaveTenant(1, tenantOverlay)}
                  disabled={loading || saving}
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save Tenant
                </Button>
              </div>
              {renderMatrix(tenantOverlay, true, setTenantOverlay)}
            </TabsContent>

            {/* Tab: Workspace */}
            <TabsContent value="workspace" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Applies to this specific workspace only.
                </div>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => handleSaveWorkspace(1, workspaceOverlay)}
                  disabled={loading || saving}
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save Workspace
                </Button>
              </div>
              {renderMatrix(workspaceOverlay, true, setWorkspaceOverlay)}
            </TabsContent>

            {/* Tab: Default (Read Only) */}
            <TabsContent value="default" className="space-y-4 mt-4">
               <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Default rules (hardcoded).
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled
                >
                  <Shield className="h-4 w-4 mr-2" />
                  Read Only
                </Button>
              </div>
              {renderMatrix(defaultPermissions, false, () => {})}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
