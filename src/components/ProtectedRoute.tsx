import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Mail, ShieldCheck, Send } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast as sonnerToast } from 'sonner';

interface AccessSettings {
  require_email_verification: boolean;
  require_admin_approval: boolean;
}

function useAccessSettings() {
  const [settings, setSettings] = useState<AccessSettings | null>(null);

  useEffect(() => {
    supabase
      .from('platform_settings')
      .select('key, value')
      .in('key', ['require_email_verification', 'require_admin_approval'])
      .then(({ data }) => {
        const map: Record<string, string> = {};
        data?.forEach(r => { map[r.key] = r.value; });
        setSettings({
          require_email_verification: map['require_email_verification'] === 'true',
          require_admin_approval: map['require_admin_approval'] === 'true',
        });
      });
  }, []);

  return settings;
}

export function ProtectedRoute({ children, role }: { children: React.ReactNode; role?: 'customer' | 'admin' }) {
  const { user, isAuthenticated, loading } = useAuth();
  const accessSettings = useAccessSettings();

  if (loading || !accessSettings) {
    return (
      <div className="min-h-screen premium-app-shell flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to={role === 'admin' ? '/admin/login' : '/login'} replace />;
  }

  // For customers, check access control settings
  if (user?.role === 'customer') {
    // Suspended customers are fully blocked
    if (user.status === 'suspended') {
      return (
        <div className="min-h-screen premium-app-shell flex items-center justify-center p-4">
          <div className="max-w-md text-center space-y-5">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
              <ShieldCheck className="w-8 h-8 text-destructive" />
            </div>
            <h1 className="text-2xl font-display font-bold text-foreground">Account Suspended</h1>
            <p className="text-muted-foreground">Your account has been suspended. Please contact support for assistance.</p>
            <button
              onClick={async () => { await supabase.auth.signOut(); window.location.href = '/login'; }}
              className="text-primary hover:underline text-sm font-medium mt-2"
            >
              Back to Login
            </button>
          </div>
        </div>
      );
    }

    const needsEmailVerification = accessSettings.require_email_verification && user.email_verified === false;
    const needsApproval = accessSettings.require_admin_approval && user.status === 'pending';

    if (needsEmailVerification || needsApproval) {
      return (
        <div className="min-h-screen premium-app-shell flex items-center justify-center p-4">
          <div className="max-w-md text-center space-y-5">
            {needsEmailVerification && needsApproval ? (
              <>
                <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto">
                  <Mail className="w-8 h-8 text-amber-500" />
                </div>
                <h1 className="text-2xl font-display font-bold text-foreground">Account Setup in Progress</h1>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-start gap-2 text-left rounded-lg border border-border p-3">
                    <Mail className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                    <span>Please verify your email address. Check your inbox for a verification link.</span>
                  </div>
                  <div className="flex items-start gap-2 text-left rounded-lg border border-border p-3">
                    <ShieldCheck className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                    <span>Your account also requires admin approval before you can access the platform.</span>
                  </div>
                </div>
                <ResendVerificationButton user={user} />
              </>
            ) : needsEmailVerification ? (
              <VerifyEmailGate user={user} />
            ) : (
              <>
                <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto">
                  <Loader2 className="w-8 h-8 text-amber-500" />
                </div>
                <h1 className="text-2xl font-display font-bold text-foreground">Account Pending Approval</h1>
                <p className="text-muted-foreground">Your account is currently being reviewed by an administrator. You'll be able to access the portal once approved.</p>
              </>
            )}
            <div className="pt-2">
              <button
                onClick={async () => { await supabase.auth.signOut(); window.location.href = '/login'; }}
                className="text-primary hover:underline text-sm font-medium"
              >
                Back to Login
              </button>
            </div>
          </div>
        </div>
      );
    }
  }

  // For admins, check if suspended (handles existing sessions after status change)
  if (user?.role === 'admin' && user.status === 'suspended') {
    return (
      <div className="min-h-screen premium-app-shell flex items-center justify-center p-4">
        <div className="max-w-md text-center space-y-5">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <ShieldCheck className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-display font-bold text-foreground">Admin Account Suspended</h1>
          <p className="text-muted-foreground">Your admin account has been suspended. Please contact the Super Admin.</p>
          <button
            onClick={async () => { await supabase.auth.signOut(); window.location.href = '/admin/login'; }}
            className="text-primary hover:underline text-sm font-medium mt-2"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  if (role && user?.role !== role) {
    return <Navigate to={user?.role === 'admin' ? '/admin' : '/dashboard'} replace />;
  }

  return <>{children}</>;
}

/** Resend verification email button with cooldown */
function ResendVerificationButton({ user }: { user: any }) {
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const handleResend = useCallback(async () => {
    if (sending || cooldown > 0) return;
    setSending(true);
    try {
      const { error } = await supabase.functions.invoke('send-verification-email', {
        body: {
          user_id: user.auth_user_id,
          email: user.email,
          full_name: user.full_name,
          site_url: window.location.origin,
        },
      });
      if (error) throw error;
      sonnerToast.success('Verification email sent!', { description: 'Check your inbox for a new verification link.' });
      setCooldown(60);
    } catch {
      sonnerToast.error('Failed to send', { description: 'Please try again in a moment.' });
    } finally {
      setSending(false);
    }
  }, [user, sending, cooldown]);

  return (
    <div>
      <button
        onClick={handleResend}
        disabled={sending || cooldown > 0}
        className="inline-flex items-center justify-center gap-2 text-sm font-medium text-primary hover:underline disabled:opacity-50 disabled:no-underline"
      >
        <Send className="w-3.5 h-3.5" />
        {sending ? 'Sending...' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend verification email'}
      </button>
    </div>
  );
}

/** Inline component for the email verification gate */
function VerifyEmailGate({ user }: { user: any }) {
  return (
    <>
      <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto">
        <Mail className="w-8 h-8 text-amber-500" />
      </div>
      <h1 className="text-2xl font-display font-bold text-foreground">Verify Your Email</h1>
      <p className="text-muted-foreground">Please verify your email address before accessing your account. Check your inbox for a verification link.</p>
      <ResendVerificationButton user={user} />
    </>
  );
}
