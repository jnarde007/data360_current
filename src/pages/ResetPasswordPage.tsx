import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Eye, EyeOff } from 'lucide-react';
import { motion } from 'framer-motion';
import logo from '@/assets/logo.png';
export default function ResetPasswordPage() {
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    // Check if this is a recovery link (user clicked email link)
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const type = hashParams.get('type');
    if (type === 'recovery') {
      setIsRecoveryMode(true);
    }
  }, []);

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast({ title: 'Email address required', description: 'Please enter your email to receive a password reset link.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) throw error;

      setSent(true);
      toast({ title: 'Reset link sent', description: 'Check your email inbox for password reset instructions.', variant: 'success' });
    } catch (error: any) {
      toast({ title: 'Unable to send reset link', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newPassword.length < 6) {
      toast({ title: 'Password too short', description: 'Your password must be at least 6 characters long.', variant: 'destructive' });
      return;
    }
    
    if (newPassword !== confirmPassword) {
      toast({ title: 'Passwords do not match', description: 'Please ensure both password fields are identical.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });

      if (error) throw error;

      toast({ title: 'Password updated successfully', description: 'You can now log in with your new password.', variant: 'success' });
      navigate('/login');
    } catch (error: any) {
      toast({ title: 'Password update failed', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen auth-bg-gradient flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-sm"
      >
        <div className="auth-glass py-6 px-5">
          <div className="flex items-center justify-center gap-2.5 mb-4">
            <img src={logo} alt="DATA360" className="w-10 h-10 rounded-xl object-cover shadow-lg" />
            <span className="font-display font-semibold text-xl text-foreground tracking-tight">DATA360</span>
          </div>
          <h1 className="font-display font-bold text-xl text-foreground mb-0.5 tracking-tight text-center">
            {isRecoveryMode ? 'Set New Password' : 'Reset Password'}
          </h1>
          <p className="text-xs text-muted-foreground mb-4 text-center">
            {isRecoveryMode ? 'Enter your new password below' : "We'll send you a password reset link"}
          </p>

          {isRecoveryMode ? (
            <form onSubmit={handleUpdatePassword} className="space-y-3">
              <div>
                <label className="auth-label">New Password</label>
                <div className="relative mt-1">
                  <Input
                    type={showNewPw ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    minLength={6}
                    autoComplete="new-password"
                    className="auth-input pr-12"
                  />
                  <button type="button" onClick={() => setShowNewPw(!showNewPw)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                    {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="auth-label">Confirm Password</label>
                <div className="relative mt-1">
                  <Input
                    type={showConfirmPw ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    className="auth-input pr-12"
                  />
                  <button type="button" onClick={() => setShowConfirmPw(!showConfirmPw)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                    {showConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="auth-btn" disabled={loading}>
                {loading ? 'Updating...' : 'Update Password'}
              </Button>
            </form>
          ) : sent ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-3">
                <span className="text-success text-lg font-bold">✓</span>
              </div>
              <p className="text-sm text-foreground font-medium mb-1">Reset link sent!</p>
              <p className="text-xs text-muted-foreground mb-4">Check your inbox at {email}</p>
              <Link to="/login"><Button variant="outline" size="sm" className="rounded-lg text-xs">Back to Login</Button></Link>
            </div>
          ) : (
            <form onSubmit={handleRequestReset} className="space-y-3">
              <div>
                <label className="auth-label">Email</label>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="auth-input mt-1"
                />
              </div>
              <Button type="submit" className="auth-btn" disabled={loading}>
                {loading ? 'Sending...' : 'Send Reset Link'}
              </Button>
            </form>
          )}

          <p className="text-xs text-muted-foreground text-center mt-4">
            Remember your password? <Link to="/login" className="text-primary hover:underline font-medium">Log in</Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
