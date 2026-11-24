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
  powerconnect_api_enabled?: boolean;
  powerconnect_product?: string;
  delivery_mode: string;
  iget_bundle_type: string;
}

type PendingMtnChange = { provider: 'Portal-02' | 'iGet' | 'PowerConnect' | 'Manual'; label: string } | null;

export default function AdminApiPage() {
  const { user: authUser } = useAuth();
  const isSuperAdmin = authUser?.adminRole === 'Super Admin';
  const { toast } = useToast();
  const [configs, setConfigs] = useState<NetworkApiConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  // MTN multi-provider state (Portal-02, iGet, PowerConnect are mutually exclusive in the backend)
  const [mtnMgmt, setMtnMgmt] = useState<MtnManagement | null>(null);
  const [mtnBundleType, setMtnBundleType] = useState('mtnup2u');
  const [powerProduct, setPowerProduct] = useState('mtn2');
  const [savingMtn, setSavingMtn] = useState(false);
  const [pendingMtnChange, setPendingMtnChange] = useState<PendingMtnChange>(null);
  const [showIgetKey, setShowIgetKey] = useState(false);
  const [showPowerKey, setShowPowerKey] = useState(false);

  // SMS settings
  const [smsSettings, setSmsSettings] = useState({ sms_api_base_url: '', sms_app_id: '', sms_app_secret: '', sms_sender_id: '', sms_callback_url: '' });
  const [savingSms, setSavingSms] = useState(false);
  const [showSmsSecret, setShowSmsSecret] = useState(false);

  // Paystack settings
  const [paystackKey, setPaystackKey] = useState('');
  const [savingPaystack, setSavingPaystack] = useState(false);
  const [showPaystackKey, setShowPaystackKey] = useState(false);

  // Auto-refund settings
  const [autoRefundSettings, setAutoRefundSettings] = useState({
    auto_refund_enabled: true,
    auto_refund_max_amount: '50.00',
    auto_refund_guest_method: 'paystack',
    auto_refund_momo_provider: 'paystack',
  });
  const [savingAutoRefund, setSavingAutoRefund] = useState(false);

  useEffect(() => {
    loadConfigs();
    loadMtnManagement();
    loadSmsSettings();
    loadPaystackSettings();
    loadAutoRefundSettings();
  }, []);

  const loadConfigs = async () => {
    const { data } = await supabase.from('network_api_configs').select('*').order('network');
    if (data) {
      setConfigs(data.map((c: any) => ({
        ...c,
        api_base_url: c.api_base_url || '',
        api_key: c.api_key || '',
        api_secret: c.api_secret || '',
        extra_params: (c.extra_params as Record<string, string>) || {},
      })));
    }
    setLoading(false);
  };

  const loadMtnManagement = async () => {
    try {
      const { data, error } = await supabase.rpc('admin_get_mtn_provider_management');
      if (error) {
        setMtnMgmt(null);
        return;
      }
      const raw = data as unknown as MtnManagement;
      setMtnMgmt(raw);
      if (raw?.iget_bundle_type) setMtnBundleType(raw.iget_bundle_type);
      if (raw?.powerconnect_product) setPowerProduct(raw.powerconnect_product);
    } catch {
      setMtnMgmt(null);
    }
  };

  const loadSmsSettings = async () => {
    const { data } = await supabase.from('platform_settings').select('key, value').in('key', [
      'sms_api_base_url', 'sms_app_id', 'sms_app_secret', 'sms_sender_id', 'sms_callback_url',
    ]);
    if (data) {
      const map: Record<string, string> = {};
      data.forEach((r: any) => { map[r.key] = r.value || ''; });
      setSmsSettings({
        sms_api_base_url: map.sms_api_base_url || '',
        sms_app_id: map.sms_app_id || '',
        sms_app_secret: map.sms_app_secret || '',
        sms_sender_id: map.sms_sender_id || '',
        sms_callback_url: map.sms_callback_url || '',
      });
    }
  };

  const loadPaystackSettings = async () => {
    const { data } = await supabase.from('platform_settings').select('value').eq('key', 'paystack_secret_key').maybeSingle();
    if (data?.value) setPaystackKey(data.value);
  };

  const loadAutoRefundSettings = async () => {
    const { data } = await supabase.from('platform_settings').select('key, value').in('key', [
      'auto_refund_enabled', 'auto_refund_max_amount', 'auto_refund_guest_method', 'auto_refund_momo_provider',
    ]);
    if (data) {
      const map: Record<string, string> = {};
      data.forEach((r: any) => { map[r.key] = r.value || ''; });
      setAutoRefundSettings({
        auto_refund_enabled: map.auto_refund_enabled !== 'false',
        auto_refund_max_amount: map.auto_refund_max_amount || '50.00',
        auto_refund_guest_method: map.auto_refund_guest_method || 'paystack',
        auto_refund_momo_provider: map.auto_refund_momo_provider || 'paystack',
      });
    }
  };

  const savePaystackKey = async () => {
    setSavingPaystack(true);
    try {
      const { error } = await supabase.from('platform_settings').upsert({
        key: 'paystack_secret_key',
        value: paystackKey,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
      if (error) throw error;
      toast({ title: 'Paystack Secret Key saved', description: 'Used for processing guest card refunds.' });
    } catch {
      toast({ title: 'Failed to save Paystack key', variant: 'destructive' });
    } finally {
      setSavingPaystack(false);
    }
  };

  const saveAutoRefundSettings = async () => {
    setSavingAutoRefund(true);
    try {
      const entries = [
        { key: 'auto_refund_enabled', value: String(autoRefundSettings.auto_refund_enabled) },
        { key: 'auto_refund_max_amount', value: autoRefundSettings.auto_refund_max_amount },
        { key: 'auto_refund_guest_method', value: autoRefundSettings.auto_refund_guest_method },
        { key: 'auto_refund_momo_provider', value: autoRefundSettings.auto_refund_momo_provider },
      ];
      for (const entry of entries) {
        const { error } = await supabase.from('platform_settings').upsert({
          key: entry.key,
          value: entry.value,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });
        if (error) throw error;
      }
      toast({ title: 'Auto-refund settings saved', description: 'Rules updated successfully.' });
    } catch {
      toast({ title: 'Failed to save auto-refund settings', variant: 'destructive' });
    } finally {
      setSavingAutoRefund(false);
    }
  };

  const updateConfig = (id: string, field: string, value: any) => {
    setConfigs(configs.map(c => (c.id === id ? { ...c, [field]: value } : c)));
  };

  const updateExtraParam = (id: string, key: string, value: string) => {
    setConfigs(configs.map(c => {
      if (c.id !== id) return c;
      return { ...c, extra_params: { ...c.extra_params, [key]: value } };
    }));
  };

  const autoSaveToggle = async (id: string, field: 'enabled' | 'available_for_purchase', value: boolean) => {
    setConfigs(prev => prev.map(c => (c.id === id ? { ...c, [field]: value } : c)));
    try {
      const { error } = await supabase.from('network_api_configs').update({ [field]: value }).eq('id', id);
      if (error) throw error;
      const label = field === 'enabled' ? 'API Delivery' : 'Available for purchase';
      toast({ title: `${label} ${value ? 'enabled' : 'disabled'}`, description: 'Changes saved immediately.' });
    } catch {
      setConfigs(prev => prev.map(c => (c.id === id ? { ...c, [field]: !value } : c)));
      toast({ title: 'Failed to update setting', description: 'Please try again.', variant: 'destructive' });
    }
  };

  const saveConfig = async (id: string) => {
    const config = configs.find(c => c.id === id);
    if (!config) return;
    setSaving(id);
    const { error } = await supabase.from('network_api_configs').update({
      api_base_url: config.api_base_url,
      api_key: config.api_key,
      api_secret: config.api_secret,
      extra_params: config.extra_params,
    }).eq('id', id);
    setSaving(null);
    if (error) toast({ title: 'Error saving config', description: error.message, variant: 'destructive' });
    else toast({ title: 'Saved', description: `${config.network} API settings updated.` });
  };

  const saveSmsSettings = async () => {
    setSavingSms(true);
    try {
      const entries = Object.entries(smsSettings).map(([key, value]) => ({
        key,
        value,
        updated_at: new Date().toISOString(),
      }));
      for (const entry of entries) {
        const { error } = await supabase.from('platform_settings').upsert(entry, { onConflict: 'key' });
        if (error) throw error;
      }
      toast({ title: 'SMS settings saved', description: 'Wittyflow API configuration updated.' });
    } catch {
      toast({ title: 'Failed to save setting', variant: 'destructive' });
    } finally {
      setSavingSms(false);
    }
  };

  // --- MTN multi-provider switching (backend enforces mutual exclusion) ---
  const currentMtnProvider = mtnMgmt
    ? mtnMgmt.portal02_api_enabled 
      ? 'Portal-02' 
      : mtnMgmt.iget_api_enabled 
      ? 'iGet' 
      : mtnMgmt.powerconnect_api_enabled 
      ? 'PowerConnect' 
      : 'Manual'
    : 'Manual';

  const requestMtnToggle = (target: 'Portal-02' | 'iGet' | 'PowerConnect', turnOn: boolean) => {
    if (!mtnMgmt) return;
    if (turnOn) {
      setPendingMtnChange({ provider: target, label: target });
    } else {
      setPendingMtnChange({ provider: 'Manual', label: 'Manual processing (all APIs OFF)' });
    }
  };

  const confirmMtnChange = async () => {
    if (!mtnMgmt || !pendingMtnChange || savingMtn) return;
    setSavingMtn(true);
    try {
      const { data, error } = await supabase.rpc('admin_switch_mtn_provider', {
        p_provider: pendingMtnChange.provider,
        p_bundle_type: mtnBundleType,
        p_product: powerProduct,
      });
      if (error) throw error;
      setMtnMgmt(data as unknown as MtnManagement);
      toast({ title: 'MTN delivery mode updated', description: 'Only new orders are affected. Existing orders keep their original provider.', variant: 'success' });
    } catch (error) {
      toast({ title: 'Change not saved', description: error instanceof Error ? error.message : 'Please refresh and try again.', variant: 'destructive' });
    } finally { 
      setSavingMtn(false); 
      setPendingMtnChange(null); 
    }
  };

  const saveMtnBundleType = async () => {
    if (!mtnMgmt || savingMtn) return;
    setSavingMtn(true);
    try {
      const { data, error } = await supabase.rpc('admin_switch_mtn_provider', {
        p_provider: currentMtnProvider,
        p_bundle_type: mtnBundleType,
        p_product: powerProduct,
      });
      if (error) throw error;
      setMtnMgmt(data as unknown as MtnManagement);
      toast({ title: 'Provider config saved', description: 'Applies to new MTN orders.', variant: 'success' });
    } catch (error) {
      toast({ title: 'Not saved', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
    } finally { 
      setSavingMtn(false); 
    }
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

  const renderToggleRow = (
    label: string,
    description: string,
    checked: boolean,
    onCheckedChange: (v: boolean) => void,
    disabled = false,
    ariaLabel?: string
  ) => (
    <div className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
      <div className="space-y-0.5 pr-4">
        <Label className="text-sm font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={ariaLabel || label}
      />
    </div>
  );

  const renderKeyField = (key: string, label: string, value: string, onChange: (v: string) => void, placeholder = 'Enter key', isSecret = false) => {
    const show = showKeys[key] || false;
    return (
      <div>
        <Label>{label} {isSecret && <span className="text-muted-foreground font-normal">(optional)</span>}</Label>
        <div className="relative mt-1">
          <Input
            type={show ? 'text' : 'password'}
            placeholder={placeholder}
            value={value}
            onChange={e => onChange(e.target.value)}
            className="font-mono text-xs pr-10"
          />
          <button
            type="button"
            onClick={() => setShowKeys(prev => ({ ...prev, [key]: !prev[key] }))}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </AdminLayout>
    );
  }

  const mtnConfig = configs.find(c => c.network === 'MTN');

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">API Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure external supplier APIs, SMS gateway, and public developer endpoints.</p>
        </div>

        <Tabs defaultValue="networks" className="space-y-4">
          <TabsList className="bg-secondary/40 border border-border/50">
            <TabsTrigger value="networks">Network APIs</TabsTrigger>
            <TabsTrigger value="sms">SMS Gateway</TabsTrigger>
            <TabsTrigger value="paystack">Payment Gateway</TabsTrigger>
            <TabsTrigger value="autorefund">Auto-Refund</TabsTrigger>
            <TabsTrigger value="public">Public API</TabsTrigger>
          </TabsList>

          {/* NETWORKS TAB */}
          <TabsContent value="networks" className="space-y-4">
            {/* Global MTN Availability Switch */}
            {mtnConfig && (
              <div className="glass-card glow-border p-4">
                {renderToggleRow(
                  'Available for Purchase (MTN)',
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
                    ? 'Orders delivered automatically via iGet. Switching this ON turns Portal-02 & PowerConnect OFF.'
                    : 'OFF — new MTN orders are processed manually unless another provider is ON.',
                  mtnMgmt?.iget_api_enabled === true,
                  v => requestMtnToggle('iGet', v),
                  !mtnMgmt || savingMtn,
                  'iGet API delivery'
                )}
              </div>

              <div>
                <Label>Base URL</Label>
                <Input value={igetBaseUrl} readOnly className="mt-1 font-mono text-xs" />
              </div>

              <div>
                <Label>API Key</Label>
                <div className="relative mt-1">
                  <Input type={showIgetKey ? 'text' : 'password'} value="••••••••••••" readOnly
                    className="font-mono text-xs pr-10" />
                  <button type="button" onClick={() => setShowIgetKey(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showIgetKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">Uses backend secret <code className="bg-background px-1 py-0.5 rounded font-mono">IGET_API_KEY</code>.</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="mtn-bundle-type">Bundle Type (iGet)</Label>
                <Select value={mtnBundleType} onValueChange={setMtnBundleType}>
                  <SelectTrigger id="mtn-bundle-type" className="w-[200px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['mtnup2u', 'mtn-justforu', 'mtn-fibre'].map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <Button onClick={() => void saveMtnBundleType()} disabled={!mtnMgmt || savingMtn} className="gap-2">
                {savingMtn && <Loader2 className="w-4 h-4 animate-spin" />}
                Save MTN iGet Config
              </Button>
            </div>

            {/* Card 2 — MTN / PowerConnect */}
            <div className="glass-card glow-border p-5 space-y-4" aria-label="MTN / PowerConnect provider configuration">
              <div className="flex items-center gap-3">
                <Wifi className="w-5 h-5 text-primary" />
                <h3 className="font-display font-semibold text-foreground text-lg">MTN / PowerConnect</h3>
              </div>

              <div className="space-y-3">
                {renderToggleRow(
                  'API Delivery',
                  mtnMgmt?.powerconnect_api_enabled
                    ? 'Orders delivered automatically via PowerConnect. Switching this ON turns Portal-02 & iGet OFF.'
                    : 'OFF — new MTN orders are processed manually unless another provider is ON.',
                  mtnMgmt?.powerconnect_api_enabled === true,
                  v => requestMtnToggle('PowerConnect', v),
                  !mtnMgmt || savingMtn,
                  'PowerConnect API delivery'
                )}
              </div>

              <div>
                <Label>Base URL</Label>
                <Input value="https://powerconnectgh.com" readOnly className="mt-1 font-mono text-xs" />
                <p className="text-[11px] text-muted-foreground mt-1">Official PowerConnectGH REST API endpoint.</p>
              </div>

              <div>
                <Label>API Key</Label>
                <div className="relative mt-1">
                  <Input type={showPowerKey ? 'text' : 'password'} value="••••••••••••" readOnly
                    className="font-mono text-xs pr-10" />
                  <button type="button" onClick={() => setShowPowerKey(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showPowerKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">Uses backend secret <code className="bg-background px-1 py-0.5 rounded font-mono">POWERCONNECT_API_KEY</code>.</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="power-product">Product Variant</Label>
                <Select value={powerProduct} onValueChange={setPowerProduct}>
                  <SelectTrigger id="power-product" className="w-[200px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mtn2">mtn2 (Standard / Default)</SelectItem>
                    <SelectItem value="mtn1">mtn1</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">Sent as the product field in the PowerConnect purchase payload.</p>
              </div>

              <Button onClick={() => void saveMtnBundleType()} disabled={!mtnMgmt || savingMtn} className="gap-2">
                {savingMtn && <Loader2 className="w-4 h-4 animate-spin" />}
                Save PowerConnect Config
              </Button>
            </div>

            {/* Card 3 — MTN / Portal-02 */}
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
                      ? 'Orders delivered automatically via Portal-02. Switching this ON turns iGet & PowerConnect OFF.'
                      : 'OFF — new MTN orders are processed manually unless another provider is ON.',
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

                <Button onClick={() => saveConfig(mtnConfig.id)} disabled={saving === mtnConfig.id} className="gap-2">
                  {saving === mtnConfig.id && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save Portal-02 Config
                </Button>
              </div>
            )}

            {/* Telecel & AirtelTigo Cards */}
            {configs.filter(c => c.network !== 'MTN').map(config => (
              <div key={config.id} className="glass-card glow-border p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <Wifi className="w-5 h-5 text-primary" />
                  <h3 className="font-display font-semibold text-foreground text-lg">{config.network}</h3>
                </div>

                <div className="space-y-3">
                  {renderToggleRow('Available for Purchase', `Allow customers to buy ${config.network} data`, config.available_for_purchase, v => autoSaveToggle(config.id, 'available_for_purchase', v))}
                  {renderToggleRow('API Delivery', `Deliver ${config.network} orders automatically via API`, config.enabled, v => autoSaveToggle(config.id, 'enabled', v))}
                </div>

                <div>
                  <Label>Base URL</Label>
                  <Input value={config.api_base_url} onChange={e => updateConfig(config.id, 'api_base_url', e.target.value)} className="mt-1 font-mono text-xs" />
                </div>

                {renderKeyField(config.id, 'API Key', config.api_key, v => updateConfig(config.id, 'api_key', v), 'Enter API key')}

                <Button onClick={() => saveConfig(config.id)} disabled={saving === config.id} className="gap-2">
                  {saving === config.id && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save {config.network} Config
                </Button>
              </div>
            ))}
          </TabsContent>

          {/* SMS TAB */}
          <TabsContent value="sms" className="space-y-4">
            <div className="glass-card glow-border p-5 space-y-4">
              <h3 className="font-display font-semibold text-foreground text-lg">Wittyflow SMS Gateway</h3>
              <div>
                <Label>API Base URL</Label>
                <Input value={smsSettings.sms_api_base_url} onChange={e => setSmsSettings(s => ({ ...s, sms_api_base_url: e.target.value }))} className="mt-1 font-mono text-xs" />
              </div>
              <div>
                <Label>App ID</Label>
                <Input value={smsSettings.sms_app_id} onChange={e => setSmsSettings(s => ({ ...s, sms_app_id: e.target.value }))} className="mt-1 font-mono text-xs" />
              </div>
              <div>
                <Label>App Secret</Label>
                <div className="relative mt-1">
                  <Input type={showSmsSecret ? 'text' : 'password'} value={smsSettings.sms_app_secret} onChange={e => setSmsSettings(s => ({ ...s, sms_app_secret: e.target.value }))} className="font-mono text-xs pr-10" />
                  <button type="button" onClick={() => setShowSmsSecret(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showSmsSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Label>Sender ID</Label>
                <Input value={smsSettings.sms_sender_id} onChange={e => setSmsSettings(s => ({ ...s, sms_sender_id: e.target.value }))} className="mt-1 font-mono text-xs" />
              </div>
              <Button onClick={saveSmsSettings} disabled={savingSms} className="gap-2">
                {savingSms && <Loader2 className="w-4 h-4 animate-spin" />}
                Save SMS Settings
              </Button>
            </div>
          </TabsContent>

          {/* PAYSTACK TAB */}
          <TabsContent value="paystack" className="space-y-4">
            <div className="glass-card glow-border p-5 space-y-4">
              <div className="flex items-center gap-3">
                <CreditCard className="w-5 h-5 text-primary" />
                <h3 className="font-display font-semibold text-foreground text-lg">Paystack Configuration</h3>
              </div>
              <div>
                <Label>Secret Key</Label>
                <div className="relative mt-1">
                  <Input type={showPaystackKey ? 'text' : 'password'} value={paystackKey} onChange={e => setPaystackKey(e.target.value)} className="font-mono text-xs pr-10" />
                  <button type="button" onClick={() => setShowPaystackKey(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showPaystackKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Button onClick={savePaystackKey} disabled={savingPaystack} className="gap-2">
                {savingPaystack && <Loader2 className="w-4 h-4 animate-spin" />}
                Save Paystack Key
              </Button>
            </div>
          </TabsContent>

          {/* AUTO-REFUND TAB */}
          <TabsContent value="autorefund" className="space-y-4">
            <div className="glass-card glow-border p-5 space-y-4">
              <h3 className="font-display font-semibold text-foreground text-lg">Automatic Refund Settings</h3>
              {renderToggleRow('Enable Auto-Refunds', 'Automatically refund failed orders', autoRefundSettings.auto_refund_enabled, v => setAutoRefundSettings(s => ({ ...s, auto_refund_enabled: v })))}
              <div>
                <Label>Maximum Auto-Refund Amount (GHS)</Label>
                <Input value={autoRefundSettings.auto_refund_max_amount} onChange={e => setAutoRefundSettings(s => ({ ...s, auto_refund_max_amount: e.target.value }))} className="mt-1 font-mono text-xs w-48" />
              </div>
              <Button onClick={saveAutoRefundSettings} disabled={savingAutoRefund} className="gap-2">
                {savingAutoRefund && <Loader2 className="w-4 h-4 animate-spin" />}
                Save Auto-Refund Settings
              </Button>
            </div>
          </TabsContent>

          {/* PUBLIC API TAB */}
          <TabsContent value="public" className="space-y-4">
            <div className="glass-card glow-border p-5 space-y-4">
              <h3 className="font-display font-semibold text-foreground text-lg">DATA360 Public API</h3>
              <div>
                <Label>API Endpoint</Label>
                <div className="flex gap-2 mt-1">
                  <Input value={publicApiUrl} readOnly className="font-mono text-xs" />
                  <Button variant="outline" size="icon" onClick={() => copyToClipboard(publicApiUrl)}>
                    {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* MTN provider change confirmation dialog */}
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
