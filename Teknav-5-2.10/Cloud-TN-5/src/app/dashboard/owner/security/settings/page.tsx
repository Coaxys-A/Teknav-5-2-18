'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Save, RefreshCw, Shield, Activity, Zap, Lock } from 'lucide-react';
import { getSecuritySettings, updateSecuritySettings } from './_actions/security';

/**
 * Owner Security Settings Page
 * M10 - Security Center: "Forms for thresholds/limits + toggles"
 */

type Settings = {
  rateLimits: {
    perIp: number;
    perUser: number;
    window: number;
  };
  bruteForce: {
    threshold: number;
    window: number;
  };
  sessionTtl: number;
  requireCsrf: boolean;
};

export default function SecuritySettingsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    rateLimits: {
      perIp: 60,
      perUser: 120,
      window: 60,
    },
    bruteForce: {
      threshold: 5,
      window: 300,
    },
    sessionTtl: 86400,
    requireCsrf: true,
  });

  const loadSettings = async () => {
    setLoading(true);
    try {
      const data = await getSecuritySettings();
      setSettings(data.data);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('rateLimits', JSON.stringify(settings.rateLimits));
      formData.append('bruteForce', JSON.stringify(settings.bruteForce));
      formData.append('sessionTtl', settings.sessionTtl.toString());
      formData.append('requireCsrf', settings.requireCsrf ? 'true' : 'false');

      await updateSecuritySettings(formData);
      toast({ title: 'Settings saved' });
      // M10: "RBAC... Server-Side" (Audit Log written by backend)
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Security Settings</h1>
        <Button variant="outline" size="icon" onClick={loadSettings} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Rate Limits */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-blue-500" />
              Rate Limits
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ip-limit">Per-IP Limit (Requests/Min)</Label>
              <Input
                id="ip-limit"
                type="number"
                value={settings.rateLimits.perIp}
                onChange={(e) => setSettings({
                  ...settings,
                  rateLimits: { ...settings.rateLimits, perIp: parseInt(e.target.value) }
                })}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">Limiting per IP helps prevent abuse.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-limit">Per-User Limit (Requests/Min)</Label>
              <Input
                id="user-limit"
                type="number"
                value={settings.rateLimits.perUser}
                onChange={(e) => setSettings({
                  ...settings,
                  rateLimits: { ...settings.rateLimits, perUser: parseInt(e.target.value) }
                })}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">Authenticated users typically have higher limits.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="window">Window (Seconds)</Label>
              <Input
                id="window"
                type="number"
                value={settings.rateLimits.window}
                onChange={(e) => setSettings({
                  ...settings,
                  rateLimits: { ...settings.rateLimits, window: parseInt(e.target.value) }
                })}
                className="w-full"
              />
            </div>
          </CardContent>
        </Card>

        {/* Brute Force */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-red-500" />
              Brute Force Protection
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bf-threshold">Threshold (Attempts)</Label>
              <Input
                id="bf-threshold"
                type="number"
                value={settings.bruteForce.threshold}
                onChange={(e) => setSettings({
                  ...settings,
                  bruteForce: { ...settings.bruteForce, threshold: parseInt(e.target.value) }
                })}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">Block login after N attempts.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bf-window">Window (Seconds)</Label>
              <Input
                id="bf-window"
                type="number"
                value={settings.bruteForce.window}
                onChange={(e) => setSettings({
                  ...settings,
                  bruteForce: { ...settings.bruteForce, window: parseInt(e.target.value) }
                })}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">Attempts reset after this time.</p>
            </div>
          </CardContent>
        </Card>

        {/* Session */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-yellow-600" />
              Session Hardening
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="session-ttl">Session TTL (Seconds)</Label>
              <Input
                id="session-ttl"
                type="number"
                value={settings.sessionTtl}
                onChange={(e) => setSettings({
                  ...settings,
                  sessionTtl: parseInt(e.target.value)
                })}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">Auto-expire sessions after this time.</p>
            </div>
            <div className="flex items-center justify-between pt-2">
              <Label htmlFor="require-csrf">Require CSRF</Label>
              <Switch
                id="require-csrf"
                checked={settings.requireCsrf}
                onCheckedChange={(checked) => setSettings({ ...settings, requireCsrf: checked })}
              />
            </div>
            <p className="text-xs text-muted-foreground">Enables CSRF protection for dashboard mutations.</p>
          </CardContent>
        </Card>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={saveSettings} disabled={saving}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
    </div>
  );
}
