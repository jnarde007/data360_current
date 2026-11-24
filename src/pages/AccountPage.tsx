import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { CustomerLayout } from '@/components/CustomerLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { User, Shield, Eye, EyeOff, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { normalizePhone, isValidPhone, PHONE_ERROR_MESSAGE } from '@/lib/validation';

const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } };

export default function AccountPage() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const [username, setUsername] = useState('');
  const [originalUsername, setOriginalUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState(user?.phone || '');
  const [saving, setSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPw, setChangingPw] = useState(false);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

  // Load full_name and username
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('customers')
      .select('full_name, username')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        const storedName = data?.full_name || '';
        const uname = data?.username || '';
        setUsername(uname);
        setOriginalUsername(uname);
        setFullName(storedName === uname ? '' : storedName);
      });
  }, [user?.id]);

  const handleSaveProfile = async () => {
    const trimmedUsername = username.trim();

    // Validate username
    if (!trimmedUsername || trimmedUsername.length < 2) {
      toast({ title: 'Invalid username', description: 'Username must be at least 2 characters long.', variant: 'destructive' });
      return;
    }

    // Validate phone (strict 10-digit local Ghana)
    if (!isValidPhone(phone)) {
      toast({ title: 'Invalid phone number', description: PHONE_ERROR_MESSAGE, variant: 'destructive' });
      return;
    }

    // Check uniqueness if username changed
    const usernameChanged = trimmedUsername.toLowerCase() !== originalUsername.toLowerCase();
    if (usernameChanged) {
      const { data: resolvedEmail } = await supabase.rpc('get_email_by_username', { p_username: trimmedUsername });
      if (resolvedEmail) {
        toast({ title: 'Username unavailable', description: 'This username is already taken. Please choose a different one.', variant: 'destructive' });
        return;
      }
    }

    setSaving(true);
    try {
      const nameToSave = fullName.trim() || user?.full_name || '';

      const cleanPhone = normalizePhone(phone);
      const updateFields: Record<string, string> = { full_name: nameToSave, phone: cleanPhone };
      if (usernameChanged) {
        updateFields.username = trimmedUsername;
      }

      const { error: custError } = await supabase
        .from('customers')
        .update(updateFields)
        .eq('id', user!.id);
      if (custError) throw custError;

      if (user?.auth_user_id) {
        await supabase
          .from('profiles')
          .update({ full_name: nameToSave, phone: cleanPhone })
          .eq('id', user.auth_user_id);
      }

      await supabase.auth.updateUser({
        data: { full_name: nameToSave, phone: cleanPhone, username: usernameChanged ? trimmedUsername : undefined },
      });

      if (usernameChanged) {
        setOriginalUsername(trimmedUsername);
      }

      await refreshUser();

      toast({ title: 'Profile updated', description: usernameChanged ? 'Your username has been updated. Use it next time you sign in.' : 'Your changes have been saved.', variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Profile update failed', description: err?.message || 'Something went wrong. Please try again.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast({ title: 'All fields required', description: 'Please fill in your current password, new password, and confirmation.', variant: 'destructive' });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: 'Password too short', description: 'Your new password must be at least 6 characters long.', variant: 'destructive' });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: 'Passwords do not match', description: 'Please ensure your new password and confirmation are identical.', variant: 'destructive' });
      return;
    }
    setChangingPw(true);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser?.email) throw new Error('Not authenticated');

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: authUser.email,
        password: currentPassword,
      });
      if (signInError) {
        toast({ title: 'Incorrect current password', description: 'The current password you entered is wrong. Please try again.', variant: 'destructive' });
        setChangingPw(false);
        return;
      }

      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast({ title: 'Password updated successfully', description: 'Your password has been changed. Use it next time you log in.', variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Password update failed', description: err?.message || 'Something went wrong. Please try again.', variant: 'destructive' });
    } finally {
      setChangingPw(false);
    }
  };

  return (
    <CustomerLayout>
      <div className="max-w-2xl mx-auto space-y-8">
        <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4 }}>
          <h1 className="text-2xl lg:text-3xl font-display font-bold text-foreground tracking-tight">My Account</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your profile and settings</p>
        </motion.div>

        {/* Profile */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm lg:text-base font-display font-bold text-foreground">Profile Information</h2>
            <div className="flex-1 h-px bg-border/60" />
          </div>
        <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.05 }}
          className="glass-card p-6 space-y-5 card-hover card-shine">
          <div className="flex items-center gap-3 mb-1">
            <div className="icon-box icon-box-lg icon-box-primary">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display font-semibold text-foreground">Personal Details</h3>
              <p className="text-xs text-muted-foreground">Update your name, username, and contact info</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Username</Label>
              <Input
                placeholder="e.g. kwame360"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="mt-1.5"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Used to log in to your account</p>
            </div>
            <div>
              <Label>Full Name <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                placeholder="e.g. John Mensah"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div><Label>Phone</Label><Input value={phone} onChange={e => setPhone(normalizePhone(e.target.value))} className="mt-1.5" type="tel" inputMode="numeric" placeholder="0241234567" /></div>
            <div><Label>Email</Label><Input value={user?.email || ''} disabled className="mt-1.5 bg-muted/50" /></div>
          </div>
          <Button onClick={handleSaveProfile} disabled={saving} className="gradient-primary text-primary-foreground border-0 shadow-sm">
            {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save Changes'}
          </Button>
        </motion.div>
        </section>

        {/* Change Password */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm lg:text-base font-display font-bold text-foreground">Security</h2>
            <div className="flex-1 h-px bg-border/60" />
          </div>
          <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.1 }}
            className="glass-card p-6 space-y-5 card-hover card-shine">
            <div className="flex items-center gap-3 mb-1">
              <div className="icon-box icon-box-lg icon-box-purple">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display font-semibold text-foreground">Change Password</h3>
                <p className="text-xs text-muted-foreground">Update your account password</p>
              </div>
            </div>
          <div className="space-y-3">
            <div>
              <Label>Current Password</Label>
              <div className="relative mt-1.5">
                <Input type={showCurrentPw ? 'text' : 'password'} placeholder="••••••••" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} autoComplete="off" />
                <button type="button" onClick={() => setShowCurrentPw(!showCurrentPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showCurrentPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <Label>New Password</Label>
              <div className="relative mt-1.5">
                <Input type={showNewPw ? 'text' : 'password'} placeholder="••••••••" value={newPassword} onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" />
                <button type="button" onClick={() => setShowNewPw(!showNewPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <Label>Confirm New Password</Label>
              <div className="relative mt-1.5">
                <Input type={showConfirmPw ? 'text' : 'password'} placeholder="••••••••" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" />
                <button type="button" onClick={() => setShowConfirmPw(!showConfirmPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
          <Button onClick={handleChangePassword} disabled={changingPw} variant="outline">
            {changingPw ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Updating...</> : 'Update Password'}
          </Button>
          </motion.div>
        </section>
      </div>
    </CustomerLayout>
  );
}
