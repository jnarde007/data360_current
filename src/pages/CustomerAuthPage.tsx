import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import logo from '@/assets/logo.png';
import AuthShell from '@/components/auth/AuthShell';
import { Eye, EyeOff, Zap, Shield, Clock, Mail, Send, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { validateEmail, validatePhone, validatePassword, normalizePhone } from '@/lib/validation';
import { toast as sonnerToast } from 'sonner';

export default function CustomerAuthPage() {
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get('ref') || '';
  const [tab, setTab] = useState(refCode ? 'signup' : 'login');
  const [signupResult, setSignupResult] = useState<{ email: string; needsVerification: boolean; userId?: string } | null>(null);

  // Show "Check your email" screen after signup with verification ON
  if (signupResult?.needsVerification) {
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

            <div className="text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-amber-500/20 flex items-center justify-center mx-auto">
                <Mail className="w-7 h-7 text-amber-400" />
              </div>
              <h1 className="font-display font-bold text-xl text-foreground">Check Your Email</h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                We've sent a verification link to <span className="text-foreground font-medium">{signupResult.email}</span>. Please check your inbox and click the link to verify your account.
              </p>

              <ResendVerificationInline email={signupResult.email} />

              <div className="pt-2 space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-lg text-xs w-full"
                  onClick={() => { setSignupResult(null); setTab('login'); }}
                >
                  Back to Login
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  // Show "Account created" screen after signup with verification OFF
  if (signupResult && !signupResult.needsVerification) {
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

            <div className="text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7 text-emerald-400" />
              </div>
              <h1 className="font-display font-bold text-xl text-foreground">Account Created!</h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Your account has been created successfully. You can now log in.
              </p>

              <Button
                className="auth-btn w-full"
                onClick={() => { setSignupResult(null); setTab('login'); }}
              >
                Go to Login
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <AuthShell>
        <div className="auth-glass py-6 px-5">
          <div className="flex items-center justify-center gap-2.5 mb-4">
            <img src={logo} alt="DATA360" className="w-10 h-10 rounded-xl object-cover shadow-lg" />
            <span className="font-display font-semibold text-xl text-foreground tracking-tight">DATA360</span>
          </div>

          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-4 auth-tabs-list">
              <TabsTrigger value="login" className="auth-tab-trigger">Log In</TabsTrigger>
              <TabsTrigger value="signup" className="auth-tab-trigger">Sign Up</TabsTrigger>
            </TabsList>
            <TabsContent value="login">
              <LoginForm onSwitchToSignup={() => setTab('signup')} />
            </TabsContent>
            <TabsContent value="signup">
              <SignupForm
                onSuccess={(result) => setSignupResult(result)}
                initialRefCode={refCode}
              />
            </TabsContent>
          </Tabs>

          {/* Trust indicators */}
          <div className="flex items-center justify-center gap-6 mt-4 pt-4 border-t border-border/40">
            {[
              { icon: Zap, label: 'Fast' },
              { icon: Shield, label: 'Reliable' },
              { icon: Clock, label: 'Secured' },
            ].map((t) => (
              <div key={t.label} className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
                <t.icon className="w-3.5 h-3.5 text-primary/70" />
                <span className="font-medium">{t.label}</span>
              </div>
            ))}
          </div>
        </div>
    </AuthShell>
  );
}

/** Resend verification email inline (for the post-signup screen).
 * Uses Supabase Auth's native resend mechanism — triggers the auth-email-hook
 * webhook with a fresh run_id. No custom edge function or stored session needed. */
function ResendVerificationInline({ email }: { email: string }) {
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const handleResend = useCallback(async () => {
    if (sending || cooldown > 0) return;
    setSending(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim().toLowerCase(),
      });
      if (error) throw error;
      sonnerToast.success('Verification email sent!', { description: 'Check your inbox for a new verification link.' });
      setCooldown(60);
      setSent(true);
    } catch {
      sonnerToast.error('Failed to send', { description: 'Please try again in a moment.' });
    } finally {
      setSending(false);
    }
  }, [email, sending, cooldown]);

  return (
    <div className="pt-1">
      <button
        onClick={handleResend}
        disabled={sending || cooldown > 0}
        className="inline-flex items-center justify-center gap-2 text-sm font-medium text-amber-400 hover:text-amber-300 disabled:opacity-50 transition-colors"
      >
        <Send className="w-3.5 h-3.5" />
        {sending ? 'Sending...' : cooldown > 0 ? `Resend in ${cooldown}s` : sent ? 'Resend again' : 'Resend verification email'}
      </button>
    </div>
  );
}

function LoginForm({ onSwitchToSignup }: { onSwitchToSignup: () => void }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [accountNotFound, setAccountNotFound] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAccountNotFound(false);
    if (!identifier || !password) { toast({ title: 'Missing credentials', description: 'Please enter your username or email and password to continue.', variant: 'destructive' }); return; }
    setLoading(true);

    let emailToUse = identifier.trim();

    // If not an email, treat as username and look up email
    if (!emailToUse.includes('@')) {
      const { data: resolvedEmail, error } = await supabase.rpc('get_email_by_username', { p_username: emailToUse });
      if (!resolvedEmail || error) {
        setLoading(false);
        setAccountNotFound(true);
        return;
      }
      emailToUse = resolvedEmail;
    }

    const result = await login(emailToUse, password);
    setLoading(false);
    if (result.success) {
      setTimeout(() => navigate('/dashboard'), 150);
    } else {
      if (/invalid.*credentials/i.test(result.message || '')) {
        setAccountNotFound(true);
      } else {
        toast({ title: 'Sign-in unsuccessful', description: result.message || 'Please check your credentials and try again.', variant: 'destructive' });
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {accountNotFound && (
        <div className="rounded-xl border border-red-400/50 bg-red-950/80 backdrop-blur-sm p-3.5 text-sm">
          <p className="font-semibold text-red-300 mb-1 text-[13px]">Sign-in unsuccessful</p>
          <p className="text-white/80 mb-2.5 text-xs leading-relaxed">We couldn't sign you in with those details. Please check your username or email and password, then try again.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-red-400/40 bg-red-500/20 text-white hover:bg-red-500/30 rounded-lg text-xs font-medium"
            onClick={onSwitchToSignup}
          >
            Create an Account
          </Button>
        </div>
      )}
      <div>
        <label className="auth-label">Username or Email</label>
        <Input placeholder="your_username or you@example.com" value={identifier} onChange={e => { setIdentifier(e.target.value); setAccountNotFound(false); }} className="auth-input mt-1" autoComplete="username" />
      </div>
      <div>
        <label className="auth-label">Password</label>
        <div className="relative mt-1">
          <Input type={showPw ? 'text' : 'password'} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} className="auth-input pr-12" autoComplete="current-password" />
          <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
            {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>
      <div className="text-right">
        <Link to="/reset-password" className="text-xs text-muted-foreground hover:text-primary hover:underline font-medium">Forgot password?</Link>
      </div>
      <Button type="submit" disabled={loading} className="auth-btn">
        {loading ? 'Logging in...' : 'Log In'}
      </Button>
    </form>
  );
}

function SignupForm({ onSuccess, initialRefCode = '' }: { onSuccess: (result: { email: string; needsVerification: boolean; userId?: string }) => void; initialRefCode?: string }) {
  const [form, setForm] = useState({ username: '', email: '', phone: '', password: '', referral_code: initialRefCode });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const { signup } = useAuth();
  const { toast } = useToast();

  const update = (k: string, v: string) => {
    setForm(f => ({ ...f, [k]: v }));
    setErrors(e => ({ ...e, [k]: '' }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: Record<string, string> = {};
    if (!form.username.trim() || form.username.trim().length < 2) newErrors.username = 'Username is required (at least 2 characters)';
    const emailErr = validateEmail(form.email);
    if (emailErr) newErrors.email = emailErr;
    const phoneErr = validatePhone(form.phone);
    if (phoneErr) newErrors.phone = phoneErr;
    const pwErr = validatePassword(form.password);
    if (pwErr) newErrors.password = pwErr;

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Check duplicate email
    const { data: existingEmail } = await supabase
      .from('customers')
      .select('id')
      .eq('email', form.email.trim().toLowerCase())
      .not('status', 'in', '("deleted","archived")')
      .is('deleted_at', null)
      .maybeSingle();
    if (existingEmail) {
      toast({ title: 'Email already registered', description: 'An account with this email already exists. Try logging in instead.', variant: 'destructive' }); return;
    }

    // Check duplicate phone
    const { data: existingPhone } = await supabase
      .from('customers')
      .select('id')
      .eq('phone', form.phone.trim())
      .not('status', 'in', '("deleted","archived")')
      .is('deleted_at', null)
      .maybeSingle();
    if (existingPhone) {
      toast({ title: 'Phone number already registered', description: 'An account with this phone number already exists. Try logging in instead.', variant: 'destructive' }); return;
    }

    // Check duplicate username
    const { data: resolvedEmail } = await supabase.rpc('get_email_by_username', { p_username: form.username.trim() });
    if (resolvedEmail) {
      toast({ title: 'Username unavailable', description: 'This username is already taken. Please choose a different one.', variant: 'destructive' }); return;
    }

    setLoading(true);
    const result = await signup({
      full_name: form.username.trim(),
      email: form.email,
      phone: form.phone,
      password: form.password,
      referral_code: form.referral_code,
      username: form.username.trim(),
    });
    setLoading(false);

    if (result.success) {
      onSuccess({
        email: form.email.trim().toLowerCase(),
        needsVerification: result.needsVerification ?? false,
        userId: result.userId,
      });
    } else {
      toast({ title: 'Signup failed', description: result.message || 'Something went wrong. Please try again or contact support.', variant: 'destructive' });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="auth-label">Username *</label>
        <Input placeholder="e.g. kwame360" value={form.username} onChange={e => update('username', e.target.value)} className="auth-input mt-1" autoComplete="username" />
        {errors.username && <p className="text-xs text-destructive mt-1">{errors.username}</p>}
      </div>
      <div>
        <label className="auth-label">Email *</label>
        <Input type="email" placeholder="you@example.com" value={form.email} onChange={e => update('email', e.target.value)} className="auth-input mt-1" autoComplete="email" />
        {errors.email && <p className="text-xs text-destructive mt-1">{errors.email}</p>}
      </div>
      <div>
        <label className="auth-label">Phone *</label>
        <Input placeholder="0241234567" value={form.phone} onChange={e => update('phone', normalizePhone(e.target.value))} className="auth-input mt-1" autoComplete="tel" type="tel" inputMode="numeric" />
        {errors.phone && <p className="text-xs text-destructive mt-1">{errors.phone}</p>}
      </div>
      <div>
        <label className="auth-label">Password *</label>
        <div className="relative mt-1">
          <Input type={showPw ? 'text' : 'password'} placeholder="Min 6 characters" value={form.password} onChange={e => update('password', e.target.value)} className="auth-input pr-12" autoComplete="new-password" />
          <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
            {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {errors.password && <p className="text-xs text-destructive mt-1">{errors.password}</p>}
      </div>
      <Button type="submit" disabled={loading} className="auth-btn">
        {loading ? 'Creating account...' : 'Sign Up'}
      </Button>
    </form>
  );
}
