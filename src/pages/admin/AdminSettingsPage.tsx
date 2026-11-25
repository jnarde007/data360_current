import { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Eye, EyeOff, Loader2, Lock, ShieldCheck, Mail, Send, Megaphone, Check } from 'lucide-react';
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

  // Dedicated Announcement State
  const [announcementEnabled, setAnnouncementEnabled] = useState(false);
  const [announcementTitle, setAnnouncementTitle] = useState('Important Update');
  const [announcementMessage, setAnnouncementMessage] = useState('');
  const [announcementType, setAnnouncementType] = useState<'warning' | 'destructive' | 'info'>('warning');
  const [savingAnnouncement, setSavingAnnouncement] = useState(false);

  // Password state
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

        if (loaded.announcement_enabled !== undefined) {
          setAnnouncementEnabled(loaded.announcement_enabled === 'true');
        }
        if (loaded.announcement_title !== undefined) {
          setAnnouncementTitle(loaded.announcement_title);
        }
        if (loaded.announcement_message !== undefined) {
          setAnnouncementMessage(loaded.announcement_message);
        }
        if (loaded.announcement_type !== undefined) {
          setAnnouncementType((loaded.announcement_type as any) || 'warning');
        }
      }
    } catch {
      toast({ title: 'Unable to load settings', description: 'Please refresh the page and try again.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Dedicated Announcement Saver
  const handleSaveAnnouncement = async () => {
    setSavingAnnouncement(true);
    try {
      const updates = [
        { key: 'announcement_enabled', value: announcementEnabled ? 'true' : 'false' },
        { key: 'announcement_title', value: announcementTitle },
        { key: 'announcement_message', value: announcementMessage },
        { key: 'announcement_type', value: announcementType },
      ];

      for (const item of updates) {
        const { error } = await supabase
          .from('platform_settings')
          .update({ value: item.value, updated_at: new Date().toISOString() })
          .eq('key', item.key);
        if (error) throw error;
      }

      toast({
        title: 'Announcement updated',
        description: 'Site announcement settings have been saved successfully.',
        variant: 'success'
      });
    } catch (err: any) {
      toast({
        title: 'Failed to save announcement',
        description: err?.message || 'Please try again.',
        variant: 'destructive'
      });
    } finally {
      setSavingAnnouncement(false);
    }
  };

  // General Settings Saver (does NOT touch announcement)
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
      toast({ title: 'Settings saved successfully', description: 'General platform settings have been updated.', variant: 'success' });
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

        {/* Site Announcement & Maintenance Ticker Card */}
        <div className="glass-card glow-border p-5 space-y-5 border-amber-500/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
                <Megaphone className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-display font-semibold text-foreground">Site Announcement</h2>
                <p className="text-xs text-muted-foreground">Live ticker banner and popup dialog for maintenance & updates</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {announcementEnabled ? 'Active' : 'Disabled'}
              </span>
              <Switch
                checked={announcementEnabled}
                onCheckedChange={setAnnouncementEnabled}
              />
            </div>
          </div>

          <div className="space-y-4 pt-2 border-t border-border/50">
            <div>
              <Label className="text-xs font-semibold">Banner Severity & Style</Label>
              <div className="grid grid-cols-3 gap-2 mt-1.5">
                <button
                  type="button"
                  onClick={() => setAnnouncementType('warning')}
                  className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border text-xs font-medium transition-all ${
                    announcementType === 'warning'
                      ? 'bg-amber-500/15 border-amber-500 text-amber-700 dark:text-amber-300 shadow-sm ring-1 ring-amber-500'
                      : 'border-border text-muted-foreground hover:bg-muted/40'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                  Warning (Amber)
                </button>

                <button
                  type="button"
                  onClick={() => setAnnouncementType('destructive')}
                  className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border text-xs font-medium transition-all ${
                    announcementType === 'destructive'
                      ? 'bg-rose-500/15 border-rose-500 text-rose-700 dark:text-rose-300 shadow-sm ring-1 ring-rose-500'
                      : 'border-border text-muted-foreground hover:bg-muted/40'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
                  Urgent (Red)
                </button>

                <button
                  type="button"
                  onClick={() => setAnnouncementType('info')}
                  className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border text-xs font-medium transition-all ${
                    announcementType === 'info'
                      ? 'bg-blue-500/15 border-blue-500 text-blue-700 dark:text-blue-300 shadow-sm ring-1 ring-blue-500'
                      : 'border-border text-muted-foreground hover:bg-muted/40'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                  Info (Blue)
                </button>
              </div>
            </div>

            <div>
              <Label htmlFor="ann-title" className="text-xs font-semibold">Announcement Title</Label>
              <Input
                id="ann-title"
                value={announcementTitle}
                onChange={e => setAnnouncementTitle(e.target.value)}
                placeholder="e.g. Important Update / Maintenance Notice"
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="ann-msg" className="text-xs font-semibold">Announcement Message</Label>
              <Textarea
                id="ann-msg"
                value={announcementMessage}
                onChange={e => setAnnouncementMessage(e.target.value)}
                placeholder="e.g. MTN delivery is temporarily paused for maintenance and will resume on the 1st of December..."
                rows={3}
                className="mt-1 text-sm"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Scrolls continuously on the top ticker banner and shows in full when customers tap to read.
              </p>
            </div>

            {/* DEDICATED ANNOUNCEMENT SAVE BUTTON */}
            <div className="pt-2 flex justify-end">
              <Button
                type="button"
                onClick={handleSaveAnnouncement}
                disabled={savingAnnouncement}
                className="bg-amber-600 hover:bg-amber-700 text-white font-medium text-xs h-9 px-4 rounded-lg gap-2 shadow-sm"
              >
                {savingAnnouncement ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Saving Announcement...
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Save Announcement
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Customer Access Control */}
        <div className="glass-card glow-border p-5 space-y-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-display font-semibold text-foreground">Customer Access Control</h2>
          </div>
          <p className="text-xs text-muted-foreground">Control how new customers gain access to the platform. Both toggles are independent and can be combined.</p>

          <div className="space-y-4">
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
        </div>

        {/* Email Notifications */}
        <div className="glass-card glow-border p-5 space-y-5">
          <div className="flex items-center gap-2">
            <Send className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-display font-semibold text-foreground">Email Notifications</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Configure email notifications sent to customers when their account is approved or email is verified.
          </p>

          <div className="space-y-4">
            <div>
              <Label>Sender Email Address</Label>
              <Input value={settings.notification_sender_email} onChange={e => updateSetting('notification_sender_email', e.target.value)} placeholder="e.g. notify@yourdomain.com" className="mt-1" />
            </div>
            <div>
              <Label>Sender Display Name</Label>
              <Input value={settings.notification_sender_name} onChange={e => updateSetting('notification_sender_name', e.target.value)} placeholder="e.g. DATA360" className="mt-1" />
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
          <h2 className="text-lg font-display font-semibold text-foreground">General Platform Details</h2>
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

          <div className="pt-2">
            <Button onClick={handleSave} disabled={saving} className="gradient-primary text-primary-foreground border-0 gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save General Details
            </Button>
          </div>
        </div>

        <DiagnosticsApprovalCard />
      </div>
    </AdminLayout>
  );
}
