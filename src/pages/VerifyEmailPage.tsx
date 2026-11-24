import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import logo from '@/assets/logo.png';
import { motion } from 'framer-motion';

type Status = 'loading' | 'success' | 'error';

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('No verification token found in the link.');
      return;
    }

    const verify = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('verify-email-token', {
          body: { token },
        });

        if (error) throw error;

        if (data?.verified) {
          setStatus('success');
          setMessage('Your email has been verified successfully!');
        } else {
          setStatus('error');
          setMessage(data?.error || 'Verification failed. The link may be invalid or expired.');
        }
      } catch (err: any) {
        setStatus('error');
        setMessage('Something went wrong. Please try again or request a new verification email.');
      }
    };

    verify();
  }, [token]);

  return (
    <div className="min-h-screen auth-bg-gradient flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="w-full max-w-md text-center"
      >
        <Link to="/" className="flex items-center justify-center gap-2.5 mb-8">
          <img src={logo} alt="DATA360" className="w-11 h-11 rounded-xl object-cover shadow-lg" />
          <span className="font-display font-bold text-2xl text-foreground tracking-tight">DATA360</span>
        </Link>

        <div className="premium-card p-8" style={{ boxShadow: 'var(--shadow-lg)' }}>
          {status === 'loading' && (
            <div className="space-y-4">
              <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto" />
              <h1 className="text-xl font-display font-bold text-foreground">Verifying your email...</h1>
              <p className="text-sm text-muted-foreground">Please wait while we confirm your email address.</p>
            </div>
          )}

          {status === 'success' && (
            <div className="space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              </div>
              <h1 className="text-xl font-display font-bold text-foreground">Email Verified!</h1>
              <p className="text-sm text-muted-foreground">{message}</p>
              <Button asChild className="w-full gradient-primary text-primary-foreground border-0 shadow-md mt-4">
                <Link to="/login">Go to Login</Link>
              </Button>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-4">
              <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
                <XCircle className="w-8 h-8 text-destructive" />
              </div>
              <h1 className="text-xl font-display font-bold text-foreground">Verification Failed</h1>
              <p className="text-sm text-muted-foreground">{message}</p>
              <Button asChild variant="outline" className="w-full mt-4">
                <Link to="/login">Back to Login</Link>
              </Button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
