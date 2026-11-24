import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/AdminLayout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Plus, Trash2, ShieldCheck, Search } from 'lucide-react';

interface Row {
  id: string;
  user_id: string | null;
  email: string | null;
  enabled: boolean;
  notes: string | null;
  created_at: string;
  created_by: string | null;
  expires_at: string | null;
}

const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function AdminCrossNetworkPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);

  // form
  const [email, setEmail] = useState('');
  const [userId, setUserId] = useState('');
  const [notes, setNotes] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [expiresAt, setExpiresAt] = useState('');

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('authorized_cross_network_users')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      toast({ title: 'Failed to load', description: error.message, variant: 'destructive' });
    } else {
      setRows((data ?? []) as Row[]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setEmail(''); setUserId(''); setNotes(''); setEnabled(true); setExpiresAt('');
    setDialogOpen(true);
  };

  const openEdit = (r: Row) => {
    setEditing(r);
    setEmail(r.email ?? '');
    setUserId(r.user_id ?? '');
    setNotes(r.notes ?? '');
    setEnabled(r.enabled);
    setExpiresAt(toLocalInput(r.expires_at));
    setDialogOpen(true);
  };

  const save = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedUserId = userId.trim();
    if (!trimmedEmail && !trimmedUserId) {
      toast({ title: 'Missing identifier', description: 'Provide an email or user ID.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const basePayload = {
      email: trimmedEmail || null,
      user_id: trimmedUserId || null,
      notes: notes.trim() || null,
      enabled,
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
    };
    let error;
    if (editing) {
      ({ error } = await supabase
        .from('authorized_cross_network_users')
        .update(basePayload as any)
        .eq('id', editing.id));
    } else {
      ({ error } = await supabase
        .from('authorized_cross_network_users')
        .insert({ ...basePayload, created_by: user?.id ?? null } as any));
    }
    setSaving(false);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: editing ? 'Entry updated' : 'Entry added' });
    setDialogOpen(false);
    load();
  };

  const toggleEnabled = async (r: Row, value: boolean) => {
    // optimistic
    setRows(prev => prev.map(x => x.id === r.id ? { ...x, enabled: value } : x));
    const { error } = await supabase
      .from('authorized_cross_network_users')
      .update({ enabled: value })
      .eq('id', r.id);
    if (error) {
      setRows(prev => prev.map(x => x.id === r.id ? { ...x, enabled: r.enabled } : x));
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase
      .from('authorized_cross_network_users')
      .delete()
      .eq('id', deleteTarget.id);
    if (error) {
      toast({ title: 'Delete failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Entry removed' });
      setRows(prev => prev.filter(x => x.id !== deleteTarget.id));
    }
    setDeleteTarget(null);
  };

  const q = search.trim().toLowerCase();
  const filtered = q
    ? rows.filter(r =>
        (r.email ?? '').toLowerCase().includes(q) ||
        (r.user_id ?? '').toLowerCase().includes(q) ||
        (r.notes ?? '').toLowerCase().includes(q))
    : rows;

  const isExpired = (r: Row) => !!r.expires_at && new Date(r.expires_at).getTime() < Date.now();

  return (
    <AdminLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-primary" /> Cross-Network Authorizations
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage customers allowed to bypass same-network validation on Buy Data.
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4" /> Add authorization
          </Button>
        </div>

        <Card className="p-4">
          <div className="relative max-w-md mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search email, user ID or notes"
              className="pl-9"
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              No authorized cross-network users yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Identifier</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => {
                    const expired = isExpired(r);
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="font-medium">{r.email ?? <span className="text-muted-foreground">—</span>}</div>
                          {r.user_id && (
                            <div className="text-[11px] text-muted-foreground font-mono">{r.user_id}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={r.enabled}
                              onCheckedChange={(v) => toggleEnabled(r, v)}
                            />
                            {expired ? (
                              <Badge variant="outline" className="text-destructive border-destructive/40">Expired</Badge>
                            ) : r.enabled ? (
                              <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30">Active</Badge>
                            ) : (
                              <Badge variant="outline">Disabled</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.expires_at ? new Date(r.expires_at).toLocaleString() : <span className="text-muted-foreground">Never</span>}
                        </TableCell>
                        <TableCell className="max-w-[260px] text-sm text-muted-foreground truncate">
                          {r.notes || '—'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(r.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => openEdit(r)}>Edit</Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setDeleteTarget(r)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit authorization' : 'Add authorization'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Provide email, user ID, or both.</p>
            </div>
            <div>
              <label className="text-sm font-medium">User ID (optional)</label>
              <Input
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="uuid"
                className="font-mono text-xs"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Notes</label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Reason for granting the bypass"
                rows={3}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Expires at (optional)</label>
              <Input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground mt-1">Leave empty for no expiry.</p>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">Enabled</div>
                <div className="text-[11px] text-muted-foreground">Off temporarily blocks the bypass without deleting the record.</div>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {editing ? 'Save changes' : 'Add entry'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Remove authorization?"
        description={`This will revoke the cross-network bypass for ${deleteTarget?.email ?? deleteTarget?.user_id ?? 'this entry'}.`}
        confirmLabel="Remove"
        onConfirm={remove}
        destructive
      />
    </AdminLayout>
  );
}
