import { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Eye, EyeOff, Loader2, Lock, ShieldCheck, Mail, Send, ExternalLink } from 'lucide-react';
import { APP_BUILD_TIME, APP_VERSION_LABEL } from '@/lib/app-version';
import { DiagnosticsApprovalCard } from '@/components/admin/DiagnosticsApprovalCard';

interface Settings {
  brand_name: string;
  affiliate_rate: string;
  support_whatsapp_url: string;
  whatsapp_channel_url: string;
  require_email_verification: string;
  require_admin_approval: string;
  notification_sender_email: string;
  notification_sender_name: string;
  send_email_on_approval: string;
  send_email_on_verification: string;
}

const defaultSettings: Settings = {
  brand_name: 'DATA360',
  affiliate_rate: '5',
  support_whatsapp_url: '',
  whatsapp_channel_url: '',
  require_email_verification: 'false',
  require_admin_approval: 'false',
  notification_sender_email: '',
  notification_sender_name: 'DATA360',
  send_email_on_approval: 'false',
  send_email_on_verification: 'false',
};

export default function AdminSettingsPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);

  useEffect(() => { loadSettings(); }, []);

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase.from('platform_settings').select('key, value');
      if (error) throw error;
      if (data) {
        const loaded: Record<string, string> = {};
        data.forEach((row: { key: string; value: string }) => { loaded[row.key] = row.value; });
        setSettings(prev => ({ ...prev, ...loaded }));
      }
    } catch {
      toast({ title: 'Unable to load settings', description: 'Please refresh the page and try again.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const [key, value] of Object.entries(settings)) {
        const { error } = await supabase
          .from('platform_settings')
          .update({ value, updated_at: new Date().toISOString() })
          .eq('key', key);
        if (error) throw error;
      }
      toast({ title: 'Settings saved successfully', description: 'All platform settings have been updated.', variant: 'success' });
    } catch {
      toast({ title: 'Failed to save settings', description: 'An error occurred while saving. Please try again.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast({ title: 'All fields required', description: 'Please fill in your current password, new password, and confirmation.', variant: 'destructive' }); return;
    }
    if (newPassword.length < 6) {
      toast({ title: 'Password too short', description: 'Your new password must be at least 6 characters long.', variant: 'destructive' }); return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: 'Passwords do not match', description: 'Please ensure your new password and confirmation are identical.', variant: 'destructive' }); return;
    }
    setChangingPassword(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error('Not authenticated');
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
      if (signInError) { toast({ title: 'Incorrect current password', description: 'The current password you entered is wrong. Please try again.', variant: 'destructive' }); setChangingPassword(false); return; }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      toast({ title: 'Password changed successfully', description: 'Your password has been updated.', variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Password change failed', description: err?.message || 'Something went wrong. Please try again.', variant: 'destructive' });
    } finally {
      setChangingPassword(false);
    }
  };

  const updateSetting = (key: keyof Settings, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  // Auto-save access control toggles immediately
  const toggleAndSave = async (key: keyof Settings, checked: boolean) => {
    const value = checked ? 'true' : 'false';
    setSettings(prev => ({ ...prev, [key]: value }));
    try {
      const { error } = await supabase
        .from('platform_settings')
        .update({ value, updated_at: new Date().toISOString() })
        .eq('key', key);
      if (error) throw error;
      toast({ title: 'Setting updated', description: 'The setting has been saved successfully.', variant: 'success' });
    } catch {
      // Revert on failure
      setSettings(prev => ({ ...prev, [key]: checked ? 'false' : 'true' }));
      toast({ title: 'Failed to save setting', description: 'The change could not be applied. Please try again.', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-2xl space-y-6">
        <h1 className="text-2xl font-display font-bold text-foreground">Platform Settings</h1>

        {/* Customer Access Control */}
        <div className="glass-card glow-border p-5 space-y-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-display font-semibold text-foreground">Customer Access Control</h2>
          </div>
          <p className="text-xs text-muted-foreground">Control how new customers gain access to the platform. Both toggles are independent and can be combined.</p>

          <div className="space-y-4">
            {/* Require Email Verification */}
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
              <div className="flex items-start gap-3">
                <Mail className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Require Email Verification</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    When enabled, new customers must verify their email before accessing the platform.
                  </p>
                </div>
              </div>
              <Switch
                checked={settings.require_email_verification === 'true'}
                onCheckedChange={(checked) => toggleAndSave('require_email_verification', checked)}
              />
            </div>

            {/* Require Admin Approval */}
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Require Admin Approval</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    When enabled, new customer accounts must be approved by an admin before they can access the platform.
                  </p>
                </div>
              </div>
              <Switch
                checked={settings.require_admin_approval === 'true'}
                onCheckedChange={(checked) => toggleAndSave('require_admin_approval', checked)}
              />
            </div>
          </div>

          {/* Current mode summary */}
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-xs font-medium text-muted-foreground">
              Current mode:{' '}
              <span className="text-foreground">
                {settings.require_email_verification !== 'true' && settings.require_admin_approval !== 'true' && 'Open access — customers can sign up and use the platform immediately.'}
                {settings.require_email_verification === 'true' && settings.require_admin_approval !== 'true' && 'Email verification required before access.'}
                {settings.require_email_verification !== 'true' && settings.require_admin_approval === 'true' && 'Admin approval required before access.'}
                {settings.require_email_verification === 'true' && settings.require_admin_approval === 'true' && 'Email verification + admin approval required before access.'}
              </span>
            </p>
          </div>
        </div>

        {/* Email Notifications */}
        <div className="glass-card glow-border p-5 space-y-5">
          <div className="flex items-center gap-2">
            <Send className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-display font-semibold text-foreground">Email Notifications</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Configure email notifications sent to customers when their account is approved or email is verified. Set up a custom email domain first by asking Lovable to "set up a custom email domain".
          </p>

          <div className="space-y-4">
            <div>
              <Label>Sender Email Address</Label>
              <Input value={settings.notification_sender_email} onChange={e => updateSetting('notification_sender_email', e.target.value)} placeholder="e.g. notify@yourdomain.com" className="mt-1" />
              <p className="text-[11px] text-muted-foreground mt-1">The email address notifications will be sent from. Requires a verified custom email domain.</p>
            </div>
            <div>
              <Label>Sender Display Name</Label>
              <Input value={settings.notification_sender_name} onChange={e => updateSetting('notification_sender_name', e.target.value)} placeholder="e.g. DATA360" className="mt-1" />
              <p className="text-[11px] text-muted-foreground mt-1">The name shown in the "From" field of notification emails.</p>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-semibold text-foreground">Notification Triggers</p>
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
              <div className="flex items-start gap-3">
                <Mail className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Account Approved</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Send an email when an admin approves a customer account.</p>
                </div>
              </div>
              <Switch
                checked={settings.send_email_on_approval === 'true'}
                onCheckedChange={(checked) => toggleAndSave('send_email_on_approval', checked)}
              />
            </div>
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
              <div className="flex items-start gap-3">
                <Mail className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Email Verified</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Send a confirmation email when a customer's email is successfully verified.</p>
                </div>
              </div>
              <Switch
                checked={settings.send_email_on_verification === 'true'}
                onCheckedChange={(checked) => toggleAndSave('send_email_on_verification', checked)}
              />
            </div>
          </div>

          {!settings.notification_sender_email && (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Mail className="w-4 h-4 text-primary" />
                </div>
                <p className="text-sm font-semibold text-foreground">Setup Required</p>
              </div>
              <div className="text-xs text-muted-foreground space-y-2">
                <p>To send email notifications, complete these steps:</p>
                <ol className="list-decimal list-inside space-y-1.5 ml-1">
                  <li>Open the Lovable chat and type: <span className="font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded">"set up a custom email domain"</span></li>
                  <li>Follow the instructions to add DNS records at your domain registrar</li>
                  <li>Wait for DNS verification (can take up to 72 hours)</li>
                  <li>Come back here and enter your <strong className="text-foreground">Sender Email</strong> and <strong className="text-foreground">Display Name</strong></li>
                  <li>Toggle on the notifications you want to send</li>
                </ol>
              </div>
            </div>
          )}
        </div>

        {/* Change Password */}
        <div className="glass-card glow-border p-5 space-y-5">
          <div className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-display font-semibold text-foreground">Change Password</h2>
          </div>
          <p className="text-xs text-muted-foreground">Update your admin login password.</p>
          <div>
            <Label>Current Password</Label>
            <div className="relative mt-1">
              <Input type={showCurrentPw ? 'text' : 'password'} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="Enter current password" className="pr-10" />
              <button type="button" onClick={() => setShowCurrentPw(!showCurrentPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                {showCurrentPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <Label>New Password</Label>
            <div className="relative mt-1">
              <Input type={showNewPw ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Enter new password" className="pr-10" />
              <button type="button" onClick={() => setShowNewPw(!showNewPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <Label>Confirm New Password</Label>
            <Input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Confirm new password" className="mt-1" />
          </div>
          <Button onClick={handleChangePassword} disabled={changingPassword} variant="outline" className="gap-2">
            {changingPassword && <Loader2 className="w-4 h-4 animate-spin" />}
            Change Password
          </Button>
        </div>

        {/* General Settings */}
        <div className="glass-card glow-border p-5 space-y-5">
          <h2 className="text-lg font-display font-semibold text-foreground">General</h2>
          <div>
            <Label>Brand Name</Label>
            <Input value={settings.brand_name} onChange={e => updateSetting('brand_name', e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Affiliate Commission Rate (%)</Label>
            <Input type="number" value={settings.affiliate_rate} onChange={e => updateSetting('affiliate_rate', e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>WhatsApp Support URL</Label>
            <Input value={settings.support_whatsapp_url} onChange={e => updateSetting('support_whatsapp_url', e.target.value)} placeholder="https://wa.me/233..." className="mt-1" />
          </div>
          <div>
            <Label>WhatsApp Channel URL</Label>
            <Input value={settings.whatsapp_channel_url} onChange={e => updateSetting('whatsapp_channel_url', e.target.value)} placeholder="https://whatsapp.com/channel/..." className="mt-1" />
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">App version:</span> v{APP_VERSION_LABEL}
            <span className="mx-2">·</span>
            Built {new Date(APP_BUILD_TIME).toLocaleString()}
          </div>
        </div>

        <DiagnosticsApprovalCard />

        <Button onClick={handleSave} disabled={saving} className="gradient-primary text-primary-foreground border-0 gap-2">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save Settings
        </Button>
      </div>
    </AdminLayout>
  );
}
