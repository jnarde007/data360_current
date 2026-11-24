import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminLayout } from '@/components/AdminLayout';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ShieldAlert, MoreHorizontal, Ban, CheckCircle, Trash2, Copy, Eye } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useIsMobile } from '@/hooks/use-mobile';
import { MobileCard } from '@/components/MobileCard';
import { DetailViewDialog, type DetailField } from '@/components/DetailViewDialog';

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  auth_user_id?: string;
}

export default function AdminAdminsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [deleteAdmin, setDeleteAdmin] = useState<AdminUser | null>(null);
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState('Manager');
  const [adding, setAdding] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);
  const [newAdminCredentials, setNewAdminCredentials] = useState<{ email: string; password: string } | null>(null);
  const [detailAdmin, setDetailAdmin] = useState<AdminUser | null>(null);

  const isSuperAdmin = user?.adminRole === 'Super Admin';

  // Redirect non-Super Admins away from this page
  useEffect(() => {
    if (user && !isSuperAdmin) {
      navigate('/admin', { replace: true });
    }
  }, [user, isSuperAdmin, navigate]);

  useEffect(() => { if (isSuperAdmin) loadAdmins(); }, [isSuperAdmin]);

  const loadAdmins = async () => {
    try {
      const { data, error } = await supabase.from('admin_users').select('*').order('created_at');
      if (error) throw error;
      setAdmins((data as AdminUser[]) || []);
    } catch {
      toast({ title: 'Unable to load admins', description: 'Please refresh the page and try again.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!isSuperAdmin) { toast({ title: 'Permission denied', description: 'Only Super Admins can add new admin users.', variant: 'destructive' }); return; }
    if (!addName.trim() || !addEmail.trim()) { toast({ title: 'Incomplete details', description: 'Please provide both name and email for the new admin.', variant: 'destructive' }); return; }
    setAdding(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-admin-user', {
        body: { name: addName.trim(), email: addEmail.trim(), role: addRole },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setAdmins(prev => [...prev, data.admin]);
      setNewAdminCredentials({ email: addEmail.trim(), password: data.default_password });
      setAddName(''); setAddEmail(''); setAddRole('Manager');
      setShowAdd(false);
      setShowCredentials(true);
      toast({ title: 'Admin added successfully', description: 'The new admin account has been created.', variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Failed to add admin', description: err?.message || 'Something went wrong. Please try again.', variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  };

  const handleSuspend = async (admin: AdminUser) => {
    if (!isSuperAdmin || admin.role === 'Super Admin') return;
    const newStatus = admin.status === 'suspended' ? 'active' : 'suspended';
    try {
      const { error } = await supabase.from('admin_users').update({ status: newStatus }).eq('id', admin.id);
      if (error) throw error;
      setAdmins(prev => prev.map(a => a.id === admin.id ? { ...a, status: newStatus } : a));
      toast({ title: `Admin ${newStatus === 'suspended' ? 'suspended' : 'reactivated'}`, description: `${admin.name} has been ${newStatus === 'suspended' ? 'suspended' : 'reactivated'}.`, variant: newStatus === 'suspended' ? 'warning' : 'success' });
    } catch {
      toast({ title: 'Status update failed', description: 'Could not update admin status. Please try again.', variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    if (!deleteAdmin || !isSuperAdmin) return;
    if (deleteAdmin.role === 'Super Admin') {
      toast({ title: 'Action denied', description: 'The Super Admin account is protected and cannot be deleted.', variant: 'destructive' });
      setDeleteAdmin(null);
      return;
    }
    try {
      const { error } = await supabase.from('admin_users').delete().eq('id', deleteAdmin.id);
      if (error) throw error;
      setAdmins(prev => prev.filter(a => a.id !== deleteAdmin.id));
      toast({ title: 'Admin removed', description: `${deleteAdmin.name} has been removed from the admin list.`, variant: 'success' });
    } catch {
      toast({ title: 'Failed to remove admin', description: 'Something went wrong. Please try again.', variant: 'destructive' });
    } finally {
      setDeleteAdmin(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied to clipboard', description: 'The text has been copied.', variant: 'success' });
  };

  const getDetailFields = (a: AdminUser): DetailField[] => [
    { label: 'Name', value: <span className="font-medium">{a.name}</span> },
    { label: 'Email', value: a.email },
    { label: 'Role', value: a.role },
    { label: 'Status', value: <StatusBadge status={a.status as 'active' | 'suspended'} /> },
  ];

  const AdminActions = ({ a }: { a: AdminUser }) => {
    if (a.role === 'Super Admin') return <span className="text-xs text-muted-foreground italic">Protected</span>;
    if (!isSuperAdmin) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="w-4 h-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {a.status === 'active' ? (
            <DropdownMenuItem onClick={() => handleSuspend(a)} className="text-warning"><Ban className="w-4 h-4 mr-2" />Suspend</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => handleSuspend(a)} className="text-primary"><CheckCircle className="w-4 h-4 mr-2" />Unsuspend</DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setDeleteAdmin(a)} className="text-destructive"><Trash2 className="w-4 h-4 mr-2" />Remove</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  if (loading) {
    return <AdminLayout><div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div></AdminLayout>;
  }

  return (
    <AdminLayout>
      <div className="space-y-4 sm:space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl sm:text-2xl font-display font-bold text-foreground">Admin Users</h1>
          {isSuperAdmin && (
            <Button onClick={() => setShowAdd(true)} className="gradient-primary text-primary-foreground border-0">Add Admin</Button>
          )}
        </div>


        {isMobile ? (
          <div className="space-y-3">
            {admins.length === 0 && <p className="text-center text-muted-foreground py-8">No admin users</p>}
            {admins.map(a => (
              <MobileCard
                key={a.id}
                fields={[
                  { label: 'Name', value: <span className="font-medium">{a.name}</span> },
                  { label: 'Role', value: <span className="text-xs">{a.role}</span> },
                  { label: 'Status', value: <StatusBadge status={a.status as 'active' | 'suspended'} /> },
                ]}
                action={
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" className="gap-1.5 text-xs flex-1" onClick={() => setDetailAdmin(a)}>
                      <Eye className="w-3.5 h-3.5" /> View
                    </Button>
                    <AdminActions a={a} />
                  </div>
                }
              />
            ))}
          </div>
        ) : (
          <div className="glass-card glow-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="p-4 font-medium text-muted-foreground">Name</th>
                  <th className="p-4 font-medium text-muted-foreground">Email</th>
                  <th className="p-4 font-medium text-muted-foreground">Role</th>
                  <th className="p-4 font-medium text-muted-foreground">Status</th>
                  {isSuperAdmin && <th className="p-4 font-medium text-muted-foreground">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {admins.map(a => (
                  <tr key={a.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                    <td className="p-4 font-medium text-foreground">{a.name}</td>
                    <td className="p-4 text-muted-foreground">{a.email}</td>
                    <td className="p-4 text-foreground">{a.role}</td>
                    <td className="p-4"><StatusBadge status={a.status as 'active' | 'suspended'} /></td>
                    {isSuperAdmin && <td className="p-4"><AdminActions a={a} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {admins.length === 0 && <p className="text-center text-muted-foreground py-8">No admin users</p>}
          </div>
        )}
      </div>

      {/* Detail Dialog */}
      <DetailViewDialog
        open={!!detailAdmin}
        onOpenChange={open => { if (!open) setDetailAdmin(null); }}
        title="Admin Details"
        subtitle="Admin user information"
        fields={detailAdmin ? getDetailFields(detailAdmin) : []}
      />

      {/* Add Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Admin</DialogTitle>
            <DialogDescription>The new admin will receive a default password that they can change in settings.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5"><Label>Name</Label><Input value={addName} onChange={e => setAddName(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={addEmail} onChange={e => setAddEmail(e.target.value)} /></div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={addRole} onValueChange={setAddRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="Manager">Manager</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={adding}>{adding && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Credentials Dialog */}
      <Dialog open={showCredentials} onOpenChange={setShowCredentials}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Admin Created Successfully</DialogTitle>
            <DialogDescription>Share these credentials with the new admin. They should change their password after first login.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
              <div>
                <p className="text-xs text-muted-foreground">Email</p>
                <p className="text-sm font-medium text-foreground">{newAdminCredentials?.email}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyToClipboard(newAdminCredentials?.email || '')}><Copy className="w-4 h-4" /></Button>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
              <div>
                <p className="text-xs text-muted-foreground">Default Password</p>
                <p className="text-sm font-mono font-medium text-foreground">{newAdminCredentials?.password}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyToClipboard(newAdminCredentials?.password || '')}><Copy className="w-4 h-4" /></Button>
            </div>
            <p className="text-xs text-destructive bg-destructive/10 p-2 rounded">
              ⚠️ The admin should change this password immediately after their first login via Settings.
            </p>
          </div>
          <DialogFooter><Button onClick={() => setShowCredentials(false)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteAdmin} onOpenChange={open => !open && setDeleteAdmin(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Admin</AlertDialogTitle>
            <AlertDialogDescription>Remove <strong>{deleteAdmin?.name}</strong> from admin users? This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
