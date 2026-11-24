import { useCallback, useEffect, useState } from 'react';
import { CustomerLayout } from '@/components/CustomerLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { DeveloperApiUsage, DeveloperApiRequestUsage } from '@/components/DeveloperApiUsage';
import { Link } from 'react-router-dom';
import { BookOpen, Copy, Check, KeyRound, Loader2, Plus, ShieldAlert } from 'lucide-react';

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString() : 'Never');

export default function DeveloperApiPage() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null);
  const [revoking, setRevoking] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('customer_api_keys')
      .select('id,name,key_prefix,is_active,last_used_at,created_at,revoked_at')
      .order('created_at', { ascending: false });
    if (error) toast.error('Could not load your API keys');
    setKeys((data as ApiKeyRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    const n = name.trim();
    if (!n) return toast.error('Give your key a name');
    setCreating(true);
    const { data, error } = await supabase.rpc('generate_customer_api_key', { p_name: n });
    setCreating(false);
    if (error) return toast.error(error.message);
    setCreateOpen(false);
    setName('');
    setCopied(false);
    setNewKey((data as { full_key: string }).full_key);
    load();
  };

  const copy = async () => {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    toast.success('API key copied');
  };

  const closeReveal = () => { setNewKey(null); setCopied(false); };

  const revoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    const { error } = await supabase.rpc('revoke_customer_api_key', { p_key_id: revokeTarget.id });
    setRevoking(false);
    setRevokeTarget(null);
    if (error) return toast.error(error.message);
    toast.success('API key revoked');
    load();
  };

  return (
    <CustomerLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><KeyRound className="h-6 w-6 text-primary" /> Developer API</h1>
            <p className="text-sm text-muted-foreground">Create keys to connect your website to DATA360.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link to="/developer-api/docs"><BookOpen className="h-4 w-4 mr-1" /> API docs</Link></Button>
            <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-1" /> Generate New API Key</Button>
          </div>
        </div>

        <Card className="rounded-[20px] p-4 sm:p-6">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : keys.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-10">You don't have any API keys yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {keys.map((k) => (
                <li key={k.id} className="py-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold truncate">{k.name}</span>
                      {k.is_active
                        ? <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30" variant="outline">Active</Badge>
                        : <Badge variant="outline" className="text-muted-foreground">Revoked</Badge>}
                    </div>
                    <code className="text-xs font-mono text-muted-foreground">{k.key_prefix}</code>
                    <div className="text-xs text-muted-foreground">
                      Created {fmt(k.created_at)} · Last used {fmt(k.last_used_at)}
                      {k.revoked_at && <> · Revoked {fmt(k.revoked_at)}</>}
                    </div>
                  </div>
                  {k.is_active && (
                    <Button variant="outline" size="sm" className="text-destructive border-destructive/40" onClick={() => setRevokeTarget(k)}>
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <DeveloperApiRequestUsage />
        <DeveloperApiUsage />
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate API key</DialogTitle>
            <DialogDescription>Give this key a name so you can recognise it later.</DialogDescription>
          </DialogHeader>
          <Input placeholder="e.g. My Online Store" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={create} disabled={creating}>{creating && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Generate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!newKey} onOpenChange={(o) => { if (!o) closeReveal(); }}>
        <DialogContent onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Your new API key</DialogTitle>
          </DialogHeader>
          <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/15 p-3 text-sm">
            <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600" />
            <p>The full API key is shown only once. Copy and store it securely. DATA360 cannot display the complete key again.</p>
          </div>
          <code className="block break-all rounded-xl bg-muted p-3 font-mono text-xs">{newKey}</code>
          <DialogFooter>
            <Button variant="outline" onClick={copy}>{copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}{copied ? 'Copied' : 'Copy'}</Button>
            <Button onClick={closeReveal}>I've saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!revokeTarget} onOpenChange={(o) => { if (!o) setRevokeTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke "{revokeTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>Any website using this key will stop working. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={revoke} disabled={revoking} className="!bg-none !bg-destructive text-destructive-foreground">Revoke</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CustomerLayout>
  );
}
