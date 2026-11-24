import { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Eye, EyeOff, Loader2, Wifi, Copy, Check, CreditCard } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';

interface NetworkApiConfig {
  id: string;
  network: string;
  api_base_url: string;
  api_key: string;
  api_secret: string;
  enabled: boolean;
  available_for_purchase: boolean;
  extra_params: Record<string, string>;
}

interface MtnManagement {
  portal02_api_enabled: boolean;
  iget_api_enabled: boolean;
  delivery_mode: string;
  iget_bundle_type: string;
}

type PendingMtnChange = { provider: 'Portal-02' | 'iGet' | 'Manual'; label: string } | null;

export default function AdminApiPage() {
  const { user: authUser } = useAuth();
  const isSuperAdmin = authUser?.adminRole === 'Super Admin';
  const { toast } = useToast();
  const [configs, setConfigs] = useState<NetworkApiConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  // MTN dual-provider state (portal02_api_enabled / iget_api_enabled are mutually exclusive in the backend)
  const [mtnMgmt, setMtnMgmt] = useState<MtnManagement | null>(null);
  const [mtnBundleType, setMtnBundleType] = useState('mtnup2u');
  const [savingMtn, setSavingMtn] = useState(false);
  const [pendingMtnChange, setPendingMtnChange] = useState<PendingMtnChange>(null);
  const [showIgetKey, setShowIgetKey] = useState(false);

  // SMS settings
  const [smsSettings, setSmsSettings] = useState({ sms_api_base_url: '', sms_app_id: '', sms_app_secret: '', sms_sender_id: '', sms_callback_url: '' });
  const [savingSms, setSavingSms] = useState(false);

  // Paystack settings
  const [paystackSettings, setPaystackSettings] = useState({ paystack_public_key: '', paystack_secret_key: '' });
  const [savingPaystack, setSavingPaystack] = useState(false);
  const [showPaystackSecret, setShowPaystackSecret] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) return;
    loadConfigs();
    loadMtnManagement();
    loadPlatformSettings();
  }, [isSuperAdmin]);

  if (!isSuperAdmin) {
    return <Navigate to="/admin" replace />;
  }

  const loadConfigs = async () => {
    try {
      const { data, error } = await supabase
        .from('network_api_configs')
        .select('*')
        .order('network');
      if (error) throw error;
      setConfigs((data || []).map((c: any) => ({
        ...c,
        available_for_purchase: c.available_for_purchase !== false,
        extra_params: typeof c.extra_params === 'object' ? c.extra_params : {},
      })));
    } catch {
      toast({ title: 'Failed to load API configs', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const loadMtnManagement = async () => {
    try {
      const { data, error } = await supabase.rpc('admin_get_mtn_provider_management');
      if (error) throw error;
      const state = data as unknown as MtnManagement;
      setMtnMgmt(state);
      setMtnBundleType(state.iget_bundle_type || 'mtnup2u');
    } catch (error) {
      toast({ title: 'Unable to load MTN provider settings', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
    }
  };

  const loadPlatformSettings = async () => {
    const { data } = await supabase.from('platform_settings').select('key, value');
    if (data) {
      const map: Record<string, string> = {};
      data.forEach((r: any) => { map[r.key] = r.value; });
      setSmsSettings({
        sms_api_base_url: map.sms_api_base_url || '',
        sms_app_id: map.sms_app_id || '',
        sms_app_secret: map.sms_app_secret || '',
        sms_sender_id: map.sms_sender_id || '',
        sms_callback_url: map.sms_callback_url || '',
      });
      setPaystackSettings({
        paystack_public_key: map.paystack_public_key || '',
        paystack_secret_key: map.paystack_secret_key || '',
      });
    }
  };

  const updateConfig = (id: string, field: keyof NetworkApiConfig, value: any) => {
    setConfigs(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const updateExtraParam = (id: string, key: string, value: string) => {
    setConfigs(prev => prev.map(c => c.id === id ? { ...c, extra_params: { ...c.extra_params, [key]: value } } : c));
  };

  const saveConfig = async (config: NetworkApiConfig) => {
    setSaving(config.id);
    try {
      // MTN automatic delivery is controlled exclusively by the MTN provider
      // switches (mtn_provider_settings), so the legacy `enabled` flag is not
      // written for MTN.
      const payload: Record<string, any> = {
        api_base_url: config.api_base_url,
        api_key: config.api_key,
        api_secret: config.api_secret,
        available_for_purchase: config.available_for_purchase,
        extra_params: config.extra_params,
        updated_at: new Date().toISOString(),
      };
      if (config.network !== 'MTN') payload.enabled = config.enabled;
      const { error } = await supabase
        .from('network_api_configs')
        .update(payload)
        .eq('id', config.id);
      if (error) throw error;
      toast({ title: `${config.network} API config saved!` });
    } catch {
      toast({ title: 'Failed to save config', variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  };

  const saveSmsSettings = async () => {
    setSavingSms(true);
    try {
      for (const [key, value] of Object.entries(smsSettings)) {
        await supabase.from('platform_settings').update({ value, updated_at: new Date().toISOString() }).eq('key', key);
      }
      toast({ title: 'SMS settings saved!' });
    } catch {
      toast({ title: 'Failed to save SMS settings', variant: 'destructive' });
    } finally {
      setSavingSms(false);
    }
  };

  const savePaystackSettings = async () => {
    setSavingPaystack(true);
    try {
      for (const [key, value] of Object.entries(paystackSettings)) {
        await supabase.from('platform_settings').update({ value, updated_at: new Date().toISOString() }).eq('key', key);
      }
      toast({ title: 'Paystack settings saved!' });
    } catch {
      toast({ title: 'Failed to save Paystack settings', variant: 'destructive' });
    } finally {
      setSavingPaystack(false);
    }
  };

  const toggleKey = (id: string) => setShowKeys(prev => ({ ...prev, [id]: !prev[id] }));

  const autoSaveToggle = async (id: string, field: 'available_for_purchase' | 'enabled', value: boolean) => {
    updateConfig(id, field, value);
    try {
      const { error } = await supabase
        .from('network_api_configs')
        .update({ [field]: value, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      const config = configs.find(c => c.id === id);
      const label = field === 'available_for_purchase' ? 'Customer availability' : 'API delivery';
      toast({ title: `${config?.network} ${label} ${value ? 'enabled' : 'disabled'}` });
    } catch {
      updateConfig(id, field, !value); // revert on failure
      toast({ title: 'Failed to save setting', variant: 'destructive' });
    }
  };

  // --- MTN dual-provider switching (backend enforces mutual exclusion) ---
  const currentMtnProvider = mtnMgmt
    ? mtnMgmt.portal02_api_enabled ? 'Portal-02' : mtnMgmt.iget_api_enabled ? 'iGet' : 'Manual'
    : 'Manual';

  const requestMtnToggle = (target: 'Portal-02' | 'iGet', turnOn: boolean) => {
    if (!mtnMgmt) return;
    if (turnOn) {
      setPendingMtnChange({ provider: target, label: target });
    } else {
      setPendingMtnChange({ provider: 'Manual', label: 'Manual processing (both APIs OFF)' });
    }
  };

  const confirmMtnChange = async () => {
    if (!mtnMgmt || !pendingMtnChange || savingMtn) return;
    setSavingMtn(true);
    try {
      const { data, error } = await supabase.rpc('admin_switch_mtn_provider', {
        p_provider: pendingMtnChange.provider,
        p_bundle_type: mtnBundleType,
        p_expected_provider: currentMtnProvider,
      });
      if (error) throw error;
      setMtnMgmt(data as unknown as MtnManagement);
      toast({ title: 'MTN delivery mode updated', description: 'Only new orders are affected. Existing orders keep their original provider.', variant: 'success' });
    } catch (error) {
      toast({ title: 'Change not saved', description: error instanceof Error ? error.message : 'Please refresh and try again.', variant: 'destructive' });
    } finally { setSavingMtn(false); setPendingMtnChange(null); }
  };

  const saveMtnBundleType = async () => {
    if (!mtnMgmt || savingMtn || mtnBundleType === mtnMgmt.iget_bundle_type) return;
    setSavingMtn(true);
    try {
      const { data, error } = await supabase.rpc('admin_switch_mtn_provider', {
        p_provider: currentMtnProvider,
        p_bundle_type: mtnBundleType,
        p_expected_provider: currentMtnProvider,
      });
      if (error) throw error;
      setMtnMgmt(data as unknown as MtnManagement);
      toast({ title: 'iGet bundle type saved', description: 'Applies to new iGet MTN orders only.', variant: 'success' });
    } catch (error) {
      toast({ title: 'Not saved', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
    } finally { setSavingMtn(false); }
  };

  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const publicApiUrl = `https://${projectId}.supabase.co/functions/v1/public-api`;
  const igetWebhookUrl = `https://${projectId}.supabase.co/functions/v1/order-webhook`;
  const igetBaseUrl = 'https://iget.onrender.com';

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

  const mtnConfig = configs.find(c => c.network === 'MTN');
  const otherConfigs = configs.filter(c => c.network !== 'MTN');

  const renderToggleRow = (label: string, hint: string, checked: boolean, onChange: (v: boolean) => void, disabled = false, ariaLabel?: string) => (
    <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-secondary/30 border border-border/50">
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={ariaLabel || label} />
    </div>
  );

  const renderKeyField = (id: string, label: string, value: string, onChange: (v: string) => void, placeholder: string, optional = false) => (
    <div>
      <Label>{label} {optional && <span className="text-muted-foreground font-normal">(optional)</span>}</Label>
      <div className="relative mt-1">
        <Input type={showKeys[id] ? 'text' : 'password'} placeholder={placeholder}
          value={value} onChange={e => onChange(e.target.value)}
          className="font-mono text-xs pr-10" />
        <button type="button" onClick={() => toggleKey(id)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
          {showKeys[id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );

  return (
    <AdminLayout>
      <div className="max-w-3xl space-y-6">
        <h1 className="text-2xl font-display font-bold text-foreground">API Configuration</h1>

        <Tabs defaultValue="networks" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="networks">Network APIs</TabsTrigger>
            <TabsTrigger value="paystack">Paystack</TabsTrigger>
            <TabsTrigger value="sms">SMS API</TabsTrigger>
            <TabsTrigger value="public">Our API</TabsTrigger>
          </TabsList>

          {/* Per-Network API Configs — exactly four provider cards */}
          <TabsContent value="networks" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">Configure separate data delivery APIs for each network. Toggle ON to enable automatic API delivery; OFF for manual processing.</p>

            {/* MTN master availability — one switch for the whole MTN network */}
            {mtnConfig && (
              <div className="glass-card glow-border p-5 space-y-3" aria-label="MTN customer availability">
                <div className="flex items-center gap-3">
                  <Wifi className="w-5 h-5 text-primary" />
                  <h3 className="font-display font-semibold text-foreground text-lg">MTN Customer Availability</h3>
                </div>
                {renderToggleRow(
                  'Available for Customers',
                  mtnConfig.available_for_purchase
                    ? 'MTN is shown to customers, guests and stores. The API Delivery switches below choose who delivers.'
                    : 'MTN is hidden everywhere. No new MTN orders can be placed.',
                  mtnConfig.available_for_purchase,
                  v => autoSaveToggle(mtnConfig.id, 'available_for_purchase', v),
                  false,
                  'MTN available for customers'
                )}
              </div>
            )}

            {/* Card 1 — MTN / iGet */}
            <div className="glass-card glow-border p-5 space-y-4" aria-label="MTN / iGet provider configuration">
              <div className="flex items-center gap-3">
                <Wifi className="w-5 h-5 text-primary" />
                <h3 className="font-display font-semibold text-foreground text-lg">MTN / iGet</h3>
              </div>

              <div className="space-y-3">
                {renderToggleRow(
                  'API Delivery',
                  mtnMgmt?.iget_api_enabled
                    ? 'Orders delivered automatically via the iGet API. Switching this ON turns MTN / Portal-02 OFF.'
                    : 'OFF — new MTN orders are processed manually unless MTN / Portal-02 API Delivery is ON.',
                  mtnMgmt?.iget_api_enabled === true,
                  v => requestMtnToggle('iGet', v),
                  !mtnMgmt || savingMtn,
                  'iGet API delivery'
                )}
              </div>

              <div>
                <Label>Base URL</Label>
                <Input value={igetBaseUrl} readOnly className="mt-1 font-mono text-xs" />
                <p className="text-[11px] text-muted-foreground mt-1">Verified iGet endpoint shared with the AirtelTigo/Telecel iGet integration.</p>
              </div>

              <div>
                <Label>API Key</Label>
                <div className="relative mt-1">
                  <Input type={showIgetKey ? 'text' : 'password'} value="••••••••••••" readOnly
                    className="font-mono text-xs pr-10" aria-label="iGet API Key (stored securely, not displayed)" />
                  <button type="button" onClick={() => setShowIgetKey(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showIgetKey ? 'Hide API key placeholder' : 'Show API key placeholder'}>
                    {showIgetKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">A key is configured as the backend secret <code className="bg-background px-1 py-0.5 rounded font-mono">IGET_API_KEY</code>. The saved key is never displayed here. Manage it in Project Settings → Secrets.</p>
              </div>

              <div>
                <Label>API Secret <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input type="password" value="" readOnly placeholder="Not required by iGet" className="mt-1 font-mono text-xs" />
              </div>

              <div>
                <Label>Provider Name</Label>
                <Input value="iGet" readOnly className="mt-1 font-mono text-xs" />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="mtn-bundle-type">Bundle Type (iGet)</Label>
                <Select value={mtnBundleType} onValueChange={setMtnBundleType}>
                  <SelectTrigger id="mtn-bundle-type" className="w-[200px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['mtnup2u', 'mtn-justforu', 'mtn-fibre'].map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">The bundleType value sent to iGet when placing MTN orders. Applies to new iGet orders only.</p>
              </div>

              <div>
                <Label>Webhook URL <span className="text-muted-foreground font-normal">(for status callbacks)</span></Label>
                <Input value={igetWebhookUrl} readOnly className="mt-1 font-mono text-xs" />
                <p className="text-[11px] text-muted-foreground mt-1">Sent automatically with each iGet order so delivery status updates come back to DATA360.</p>
              </div>

              <Button onClick={() => void saveMtnBundleType()} disabled={!mtnMgmt || savingMtn || mtnBundleType === mtnMgmt.iget_bundle_type} className="gap-2">
                {savingMtn && <Loader2 className="w-4 h-4 animate-spin" />}
                Save MTN iGet Config
              </Button>
            </div>

            {/* Card 2 — MTN / Portal-02 */}
            {mtnConfig && (
              <div className="glass-card glow-border p-5 space-y-4" aria-label="MTN / Portal-02 provider configuration">
                <div className="flex items-center gap-3">
                  <Wifi className="w-5 h-5 text-primary" />
                  <h3 className="font-display font-semibold text-foreground text-lg">MTN / Portal-02</h3>
                </div>

                <div className="space-y-3">
                  {renderToggleRow(
                    'API Delivery',
                    mtnMgmt?.portal02_api_enabled
                      ? 'Orders delivered automatically via the Portal-02 API. Switching this ON turns MTN / iGet OFF.'
                      : 'OFF — new MTN orders are processed manually unless MTN / iGet API Delivery is ON.',
                    mtnMgmt?.portal02_api_enabled === true,
                    v => requestMtnToggle('Portal-02', v),
                    !mtnMgmt || savingMtn,
                    'Portal-02 API delivery'
                  )}
                </div>

                <div>
                  <Label>Base URL</Label>
                  <Input placeholder="https://api.supplier.com/v1" value={mtnConfig.api_base_url}
                    onChange={e => updateConfig(mtnConfig.id, 'api_base_url', e.target.value)} className="mt-1 font-mono text-xs" />
                </div>

                {renderKeyField(mtnConfig.id, 'API Key', mtnConfig.api_key, v => updateConfig(mtnConfig.id, 'api_key', v), 'Enter API key')}
                {renderKeyField(`${mtnConfig.id}_secret`, 'API Secret', mtnConfig.api_secret, v => updateConfig(mtnConfig.id, 'api_secret', v), 'Enter API secret', true)}

                <div>
                  <Label>Provider Name</Label>
                  <Input value="Portal-02" readOnly className="mt-1 font-mono text-xs" />
                </div>

                <div>
                  <Label>Webhook URL <span className="text-muted-foreground font-normal">(for status callbacks)</span></Label>
                  <Input placeholder="https://yourdomain.com/webhook/orders" value={mtnConfig.extra_params.webhook_url || ''}
                    onChange={e => updateExtraParam(mtnConfig.id, 'webhook_url', e.target.value)} className="mt-1 font-mono text-xs" />
                </div>

                <Button onClick={() => saveConfig(mtnConfig)} disabled={saving === mtnConfig.id} className="gap-2">
                  {saving === mtnConfig.id && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save MTN Portal-02 Config
                </Button>
              </div>
            )}

            {/* Cards 3 & 4 — AirtelTigo and Telecel (independent switches) */}
            {otherConfigs.map(config => (
              <div key={config.id} className="glass-card glow-border p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <Wifi className="w-5 h-5 text-primary" />
                  <h3 className="font-display font-semibold text-foreground text-lg">{config.network}</h3>
                </div>

                <div className="space-y-3">
                  {renderToggleRow(
                    'Available for Customers',
                    'Show this network on the Buy Data page. Turn OFF to hide during outages.',
                    config.available_for_purchase,
                    v => autoSaveToggle(config.id, 'available_for_purchase', v)
                  )}
                  {renderToggleRow(
                    'API Delivery',
                    config.enabled ? 'Orders delivered automatically via API' : 'Orders processed manually by admin',
                    config.enabled,
                    v => autoSaveToggle(config.id, 'enabled', v)
                  )}
                </div>

                <div>
                  <Label>Base URL</Label>
                  <Input placeholder="https://api.supplier.com/v1" value={config.api_base_url}
                    onChange={e => updateConfig(config.id, 'api_base_url', e.target.value)} className="mt-1 font-mono text-xs" />
                </div>

                {renderKeyField(config.id, 'API Key', config.api_key, v => updateConfig(config.id, 'api_key', v), 'Enter API key')}
                {renderKeyField(`${config.id}_secret`, 'API Secret', config.api_secret, v => updateConfig(config.id, 'api_secret', v), 'Enter API secret', true)}

                <div>
                  <Label>Provider Name</Label>
                  <Input placeholder="e.g. iGet, Portal-02" value={config.extra_params.provider || ''}
                    onChange={e => updateExtraParam(config.id, 'provider', e.target.value)} className="mt-1 font-mono text-xs" />
                  <p className="text-[11px] text-muted-foreground mt-1">Determines routing logic. Use "iGet" for iGet-based networks, "Portal-02" for Portal-02.</p>
                </div>

                {config.extra_params.provider === 'iGet' && (
                  <div>
                    <Label>Bundle Type (iGet)</Label>
                    <Input placeholder="e.g. Telecel-5959, AT-ishare" value={config.extra_params.bundle_type || ''}
                      onChange={e => updateExtraParam(config.id, 'bundle_type', e.target.value)} className="mt-1 font-mono text-xs" />
                    {config.network === 'AirtelTigo' && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span>Per iGet docs, AirtelTigo uses <code className="bg-background px-1 py-0.5 rounded font-mono">AT-ishare</code>.</span>
                      </div>
                    )}
                    <p className="text-[11px] text-muted-foreground mt-1">The bundleType value sent to iGet when placing orders.</p>
                  </div>
                )}

                <div>
                  <Label>Webhook URL <span className="text-muted-foreground font-normal">(for status callbacks)</span></Label>
                  <Input placeholder="https://yourdomain.com/webhook/orders" value={config.extra_params.webhook_url || ''}
                    onChange={e => updateExtraParam(config.id, 'webhook_url', e.target.value)} className="mt-1 font-mono text-xs" />
                </div>

                <Button onClick={() => saveConfig(config)} disabled={saving === config.id} className="gap-2">
                  {saving === config.id && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save {config.network} Config
                </Button>
              </div>
            ))}
          </TabsContent>

          {/* Paystack */}
          <TabsContent value="paystack" className="space-y-4 mt-4">
            <div className="glass-card glow-border p-5 space-y-5">
              <div className="flex items-center gap-3">
                <CreditCard className="w-5 h-5 text-primary" />
                <div>
                  <h3 className="font-display font-semibold text-foreground text-lg">Paystack Integration</h3>
                  <p className="text-xs text-muted-foreground mt-1">Configure Paystack keys for automatic wallet top-ups</p>
                </div>
              </div>
              <div>
                <Label>Paystack Public Key</Label>
                <Input placeholder="pk_test_... or pk_live_..." value={paystackSettings.paystack_public_key}
                  onChange={e => setPaystackSettings(p => ({ ...p, paystack_public_key: e.target.value }))}
                  className="mt-1 font-mono text-xs" />
              </div>
              <div>
                <Label>Paystack Secret Key</Label>
                <div className="relative mt-1">
                  <Input type={showPaystackSecret ? 'text' : 'password'} placeholder="sk_test_... or sk_live_..."
                    value={paystackSettings.paystack_secret_key}
                    onChange={e => setPaystackSettings(p => ({ ...p, paystack_secret_key: e.target.value }))}
                    className="mt-1 font-mono text-xs pr-10" />
                  <button type="button" onClick={() => setShowPaystackSecret(!showPaystackSecret)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                    {showPaystackSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Get your keys from your{' '}
                  <a href="https://dashboard.paystack.com/#/settings/developers" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                    Paystack Dashboard
                  </a>
                </p>
              </div>
              <Button onClick={savePaystackSettings} disabled={savingPaystack} className="gap-2">
                {savingPaystack && <Loader2 className="w-4 h-4 animate-spin" />}
                Save Paystack Settings
              </Button>
            </div>
          </TabsContent>

          {/* SMS API */}
          <TabsContent value="sms" className="space-y-4 mt-4">
            <div className="glass-card glow-border p-5 space-y-4">
              <h3 className="font-display font-semibold text-foreground text-lg">SMS Gateway (Wittyflow)</h3>
              <p className="text-xs text-muted-foreground">Configure Wittyflow SMS credentials for notifications and delivery alerts</p>
              <div>
                <Label>Base URL</Label>
                <Input placeholder="https://api.wittyflow.com/v1" value={smsSettings.sms_api_base_url}
                  onChange={e => setSmsSettings(p => ({ ...p, sms_api_base_url: e.target.value }))} className="mt-1 font-mono text-xs" />
              </div>
              <div>
                <Label>App ID</Label>
                <Input placeholder="Enter Wittyflow App ID" value={smsSettings.sms_app_id}
                  onChange={e => setSmsSettings(p => ({ ...p, sms_app_id: e.target.value }))} className="mt-1 font-mono text-xs" />
              </div>
              <div>
                <Label>App Secret</Label>
                <Input placeholder="Enter Wittyflow App Secret" value={smsSettings.sms_app_secret} type="password"
                  onChange={e => setSmsSettings(p => ({ ...p, sms_app_secret: e.target.value }))} className="mt-1 font-mono text-xs" />
              </div>
              <div>
                <Label>Sender ID</Label>
                <Input placeholder="e.g. DATA360" value={smsSettings.sms_sender_id}
                  onChange={e => setSmsSettings(p => ({ ...p, sms_sender_id: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>Callback URL <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input placeholder="https://your-domain.com/sms-callback" value={smsSettings.sms_callback_url}
                  onChange={e => setSmsSettings(p => ({ ...p, sms_callback_url: e.target.value }))} className="mt-1 font-mono text-xs" />
              </div>
              <Button onClick={saveSmsSettings} disabled={savingSms} className="gap-2">
                {savingSms && <Loader2 className="w-4 h-4 animate-spin" />}
                Save SMS Settings
              </Button>
            </div>
          </TabsContent>

          {/* Public API */}
          <TabsContent value="public" className="space-y-4 mt-4">
            <div className="glass-card glow-border p-5 space-y-4">
              <h3 className="font-display font-semibold text-foreground text-lg">DATA360 Public API</h3>
              <p className="text-sm text-muted-foreground">
                Share this API endpoint with third-party integrators who want to connect their websites to DATA360 for data purchases.
              </p>
              <div>
                <Label>API Endpoint</Label>
                <div className="flex gap-2 mt-1">
                  <Input value={publicApiUrl} readOnly className="font-mono text-xs" />
                  <Button variant="outline" size="icon" onClick={() => copyToClipboard(publicApiUrl)}>
                    {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              <div className="rounded-lg bg-secondary/50 p-4 space-y-3">
                <h4 className="font-semibold text-foreground text-sm">API Documentation</h4>
                <div className="text-xs text-muted-foreground space-y-2">
                  <p><strong>POST</strong> <code className="bg-background px-1 py-0.5 rounded">/place-order</code></p>
                  <p>Headers: <code className="bg-background px-1 py-0.5 rounded">Authorization: Bearer YOUR_API_KEY</code></p>
                  <p>Body:</p>
                  <pre className="bg-background p-3 rounded-lg overflow-x-auto text-xs">
{`{
  "network": "MTN",
  "phone": "024XXXXXXX",
  "bundle_size": "1GB",
  "quantity": 1
}`}
                  </pre>
                  <p>Response:</p>
                  <pre className="bg-background p-3 rounded-lg overflow-x-auto text-xs">
{`{
  "success": true,
  "order_id": "ORD-1234",
  "message": "Order placed successfully"
}`}
                  </pre>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* MTN provider change confirmation */}
        <AlertDialog open={!!pendingMtnChange} onOpenChange={open => { if (!open) setPendingMtnChange(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm MTN provider change</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to switch the active MTN provider? All new MTN orders will be routed through the selected provider. Existing orders will not be affected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <p className="text-sm text-foreground">New mode: {pendingMtnChange?.label}</p>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={savingMtn}>Cancel</AlertDialogCancel>
              <AlertDialogAction disabled={savingMtn} onClick={e => { e.preventDefault(); void confirmMtnChange(); }}>
                {savingMtn ? 'Saving…' : 'Confirm change'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AdminLayout>
  );
}
