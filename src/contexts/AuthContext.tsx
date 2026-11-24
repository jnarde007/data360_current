/**
 * AuthContext — Authentication & Access Control
 *
 * ARCHITECTURE OVERVIEW
 * =====================
 * Two platform toggles control post-signup access:
 *   1. require_email_verification — user must confirm email before access
 *   2. require_admin_approval     — user stays "pending" until admin activates
 *
 * Supabase Auth is configured with auto_confirm_email = FALSE.
 * Email verification is handled natively by Supabase Auth:
 *
 *   - When verification is ON: Supabase fires a signup webhook to
 *     auth-email-hook, which sends a branded confirmation email.
 *     The user clicks the link → Supabase confirms the email.
 *     On next session load, sync_email_verified() syncs
 *     auth.users.email_confirmed_at → customers.email_verified.
 *   - When verification is OFF: The client calls confirm-user-email
 *     immediately after signup to force-confirm the user.
 *     auth-email-hook skips sending the confirmation email.
 *
 * ProtectedRoute reads both platform_settings and the customer record
 * to gate dashboard access.
 *
 * LEGACY SUPPORT
 * ==============
 * Users who signed up before auto_confirm_email was changed may still have
 * unconfirmed emails in Supabase Auth. The tryLegacyAutoConfirm function
 * handles these by force-confirming via the "confirm-user-email" edge function.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Session, AuthChangeEvent } from '@supabase/supabase-js';
import { toast as sonnerToast } from 'sonner';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  role: 'customer' | 'admin';
  full_name: string;
  email: string;
  phone: string;
  wallet_balance: number;
  affiliate_code: string;
  total_commission: number;
  pending_commission: number;
  available_commission: number;
  auth_user_id?: string;
  adminRole?: string;
  status?: string;
  email_verified?: boolean;
  customer_id?: string;
  referred_by?: string | null;
  created_at?: string;
}

type AuthResult = { success: boolean; message?: string };

type AccountContext =
  | { kind: 'admin'; record: any }
  | { kind: 'customer'; record: any }
  | { kind: 'none' };

type FetchUserDataResult =
  | { ok: true; user: User | null }
  | { ok: false; reason: 'missing_account' | 'load_failed'; error?: unknown };

function isFetchUserDataFailure(result: FetchUserDataResult): result is Extract<FetchUserDataResult, { ok: false }> {
  return result.ok === false;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthResult>;
  adminLogin: (email: string, password: string) => Promise<AuthResult>;
  signup: (data: { full_name: string; email: string; phone: string; password: string; referral_code?: string; username?: string }) => Promise<{ success: boolean; message?: string; needsVerification?: boolean; userId?: string; email?: string }>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a User object from an admin_users row */
function buildAdminUser(adminRecord: any, authUserId: string): User {
  return {
    id: adminRecord.id,
    role: 'admin',
    full_name: adminRecord.name,
    email: adminRecord.email,
    phone: '',
    wallet_balance: 0,
    affiliate_code: '',
    total_commission: 0,
    pending_commission: 0,
    available_commission: 0,
    auth_user_id: authUserId,
    adminRole: adminRecord.role,
    status: adminRecord.status || 'active',
  };
}

/** Build a User object from a customers row */
function buildCustomerUser(customerRecord: any, authUserId: string): User {
  return {
    id: customerRecord.id,
    role: 'customer',
    full_name: customerRecord.full_name,
    email: customerRecord.email,
    phone: customerRecord.phone,
    wallet_balance: Number(customerRecord.wallet_balance),
    affiliate_code: customerRecord.affiliate_code,
    total_commission: Number(customerRecord.total_commission),
    pending_commission: Math.max(0, Number(customerRecord.total_commission) - Number(customerRecord.available_commission)),
    available_commission: Number(customerRecord.available_commission),
    auth_user_id: authUserId,
    customer_id: customerRecord.id,
    status: customerRecord.status || 'pending',
    email_verified: customerRecord.email_verified !== false,
    referred_by: customerRecord.referred_by,
    created_at: customerRecord.created_at,
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || '');
  }
  return '';
}

function isNetworkLikeError(message: string): boolean {
  return /load failed|failed to fetch|network ?error|network request failed|fetch failed|typeerror|upstream connect|connection failure|reset before headers|connect error|bad gateway|service unavailable|gateway timeout/i.test(message);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function mapAuthErrorToMessage(error: unknown, stage: 'signin' | 'account' | 'admin-check'): string {
  const message = getErrorMessage(error).trim();

  if (isNetworkLikeError(message)) {
    if (stage === 'account') {
      return 'Sign-in succeeded, but dashboard data failed to load. Please try again.';
    }
    if (stage === 'admin-check') {
      return 'Unable to reach server while verifying admin access. Please try again.';
    }
    return 'Unable to reach server. Please check your connection and try again.';
  }

  if (/invalid.*credentials/i.test(message)) {
    return 'Invalid username, email, or password.';
  }

  if (/email.*(not\s+confirmed|unconfirmed)/i.test(message)) {
    return 'Please verify your email before logging in. Check your inbox for a verification link.';
  }

  if (stage === 'account') {
    return message || 'Failed to load account data after sign-in.';
  }

  return message || 'Sign-in failed. Please try again.';
}

/**
 * Handle legacy unconfirmed users during login.
 *
 * Returns the retry session if successful, or null if it can't help.
 */
async function tryLegacyAutoConfirm(email: string, password: string): Promise<Session | null> {
  try {
    const { data: customer } = await supabase
      .from('customers')
      .select('auth_user_id')
      .eq('email', email.trim().toLowerCase())
      .not('status', 'in', '("deleted","archived")')
      .is('deleted_at', null)
      .maybeSingle();

    const { data: setting } = await supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'require_email_verification')
      .maybeSingle();

    if (customer?.auth_user_id && setting?.value !== 'true') {
      await supabase.functions.invoke('confirm-user-email', {
        body: { user_id: customer.auth_user_id },
      });
      const { data: retry } = await supabase.auth.signInWithPassword({ email, password });
      return retry?.session ?? null;
    }
  } catch (e) {
    console.error('Legacy auto-confirm failed:', e);
  }
  return null;
}

// ─── Provider ───────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const skipAuthListenerRef = useRef(false);
  const retainedUserRef = useRef<User | null>(null);
  const recoveryTimerRef = useRef<number | null>(null);

  useEffect(() => {
    retainedUserRef.current = user;
  }, [user]);

  const resolveAccountContextOnce = useCallback(async (authUserId: string): Promise<AccountContext> => {
    const [adminRes, customerRes] = await Promise.all([
      supabase
        .from('admin_users')
        .select('*')
        .eq('auth_user_id', authUserId)
        .maybeSingle(),
      supabase
        .from('customers')
        .select('*')
        .eq('auth_user_id', authUserId)
        .not('status', 'in', '("deleted","archived")')
        .is('deleted_at', null)
        .maybeSingle(),
    ]);

    if (adminRes.error) throw adminRes.error;
    if (customerRes.error) throw customerRes.error;

    if (adminRes.data) return { kind: 'admin', record: adminRes.data };
    if (customerRes.data) return { kind: 'customer', record: customerRes.data };
    return { kind: 'none' };
  }, []);

  // Retry brief backend connection drops (e.g. "upstream connect error") so a
  // momentary blip doesn't sign the user straight back out.
  const resolveAccountContext = useCallback(async (authUserId: string): Promise<AccountContext> => {
    const delays = [400, 1000, 2000];
    let lastError: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await resolveAccountContextOnce(authUserId);
      } catch (error) {
        lastError = error;
        if (!isNetworkLikeError(getErrorMessage(error)) || attempt === delays.length) throw error;
        await sleep(delays[attempt]);
      }
    }
    throw lastError;
  }, [resolveAccountContextOnce]);

  // ─── Fetch user profile from session ──────────────────────────────────

  const fetchUserData = useCallback(async (
    session: Session | null,
    options: { allowRecoveryRetry?: boolean } = {}
  ): Promise<FetchUserDataResult> => {
    if (!session?.user) {
      setUser(null);
      setLoading(false);
      return { ok: true, user: null };
    }

    const authUser = session.user;

    try {
      const accountContext = await resolveAccountContext(authUser.id);

      if (accountContext.kind === 'admin') {
        const adminUser = buildAdminUser(accountContext.record, authUser.id);
        setUser(adminUser);
        setLoading(false);
        if (recoveryTimerRef.current !== null) {
          window.clearTimeout(recoveryTimerRef.current);
          recoveryTimerRef.current = null;
        }
        return { ok: true, user: adminUser };
      }

      let customerRecord: any = accountContext.kind === 'customer' ? accountContext.record : null;

      // If customer exists but email_verified is false, sync from auth.users.
      // This handles the Supabase Auth native confirmation flow: after the user
      // clicks the confirmation link, email_confirmed_at is set in auth.users.
      // sync_email_verified() copies that status to customers.email_verified.
      if (customerRecord && !customerRecord.email_verified) {
        try {
          await supabase.rpc('sync_email_verified');
          const { data: refreshed } = await supabase
            .from('customers')
            .select('*')
            .eq('auth_user_id', authUser.id)
            .not('status', 'in', '("deleted","archived")')
            .is('deleted_at', null)
            .maybeSingle();
          if (refreshed) {
            customerRecord = refreshed;
          }
        } catch (syncErr) {
          console.warn('sync_email_verified failed, using cached value', syncErr);
        }
      }

      if (customerRecord) {
        const customerUser = buildCustomerUser(customerRecord, authUser.id);
        setUser(customerUser);
        setLoading(false);
        if (recoveryTimerRef.current !== null) {
          window.clearTimeout(recoveryTimerRef.current);
          recoveryTimerRef.current = null;
        }
        return { ok: true, user: customerUser };
      } else {
        setUser(null);
        setLoading(false);
        return { ok: false, reason: 'missing_account' };
      }
    } catch (error) {
      console.error('Auth profile refresh failed', {
        authUserId: authUser.id,
        error,
      });

      if (options.allowRecoveryRetry !== false && recoveryTimerRef.current === null) {
        recoveryTimerRef.current = window.setTimeout(async () => {
          recoveryTimerRef.current = null;
          const { data: { session: retrySession } } = await supabase.auth.getSession();
          if (retrySession) {
            await fetchUserData(retrySession, { allowRecoveryRetry: false });
          } else if (!retainedUserRef.current) {
            setLoading(false);
          }
        }, 1200);
      }

      if (retainedUserRef.current) {
        setLoading(false);
        return { ok: false, reason: 'load_failed', error };
      }

      if (options.allowRecoveryRetry !== false) {
        setLoading(true);
        return { ok: false, reason: 'load_failed', error };
      }

      setUser(null);
      setLoading(false);
      return { ok: false, reason: 'load_failed', error };
    }
  }, [resolveAccountContext]);

  // ─── Auth state listener ──────────────────────────────────────────────

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        if (skipAuthListenerRef.current) return;

        if (!session && event !== 'SIGNED_OUT') {
          return;
        }

        setTimeout(() => fetchUserData(session), 0);
      }
    );

    const bootstrapSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await fetchUserData(session);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
      const { data: { session: retrySession } } = await supabase.auth.getSession();
      await fetchUserData(retrySession);
    };
    bootstrapSession();

    const handleVisibilityResume = () => {
      if (document.visibilityState !== 'visible') return;

      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          setTimeout(() => fetchUserData(session), 0);
          return;
        }

        if (retainedUserRef.current) {
          window.setTimeout(async () => {
            const { data: { session: retrySession } } = await supabase.auth.getSession();
            if (retrySession) {
              setTimeout(() => fetchUserData(retrySession), 0);
            }
          }, 700);
        }
      });
    };
    document.addEventListener('visibilitychange', handleVisibilityResume);

    return () => {
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityResume);
      if (recoveryTimerRef.current !== null) {
        window.clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      }
    };
  }, [fetchUserData]);

  // ─── Realtime: watch customer record changes ─────────────────────────

  useEffect(() => {
    if (!user || user.role !== 'customer') return;

    const channel = supabase
      .channel('auth-wallet-live')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'customers', filter: `id=eq.${user.id}` },
        (payload) => {
          const n = payload.new as any;
          const o = payload.old as any;

          if (o.status === 'pending' && n.status === 'active') {
            sonnerToast.success('Account Approved!', {
              description: 'Your account has been approved. You now have full access.',
            });
          }

          if (o.email_verified === false && n.email_verified === true) {
            sonnerToast.success('Email Verified!', {
              description: 'Your email address has been successfully verified.',
            });
          }

          setUser(prev => {
            if (!prev) return prev;
            const bal = Number(n.wallet_balance);
            const comm = Number(n.total_commission);
            const avail = Number(n.available_commission);
            return {
              ...prev,
              wallet_balance: Number.isFinite(bal) ? bal : prev.wallet_balance,
              total_commission: Number.isFinite(comm) ? comm : prev.total_commission,
              available_commission: Number.isFinite(avail) ? avail : prev.available_commission,
              pending_commission: Number.isFinite(comm) && Number.isFinite(avail)
                ? Math.max(0, comm - avail) : prev.pending_commission,
              status: n.status || prev.status,
              email_verified: typeof n.email_verified === 'boolean' ? n.email_verified : prev.email_verified,
            };
          });
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id, user?.role]);

  // ─── Realtime: watch admin record changes (suspend/activate) ─────────

  useEffect(() => {
    if (!user || user.role !== 'admin') return;

    const channel = supabase
      .channel('auth-admin-live')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'admin_users', filter: `id=eq.${user.id}` },
        (payload) => {
          const n = payload.new as any;
          setUser(prev => {
            if (!prev) return prev;
            return { ...prev, status: n.status || prev.status };
          });
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id, user?.role]);

  // ─── Login ────────────────────────────────────────────────────────────

  const login = useCallback(async (email: string, password: string) => {
    skipAuthListenerRef.current = true;

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        // Handle legacy unconfirmed users or users who haven't clicked confirmation yet
        if (/email.*(not\s+confirmed|unconfirmed)/i.test(error.message)) {
          const retrySession = await tryLegacyAutoConfirm(email, password);
          if (retrySession) {
            const retryResult = await fetchUserData(retrySession);
            if (isFetchUserDataFailure(retryResult)) {
              const retryError = retryResult.error;
              console.error('Login retry succeeded but account context failed to load', { email, retryResult });
              await supabase.auth.signOut();
              setUser(null);
              return { success: false, message: mapAuthErrorToMessage(retryError, 'account') };
            }
            return { success: true };
          }
          return {
            success: false,
            message: 'Please verify your email before logging in. Check your inbox for a verification link.',
          };
        }

        console.error('Customer sign-in failed', { email, error });
        return { success: false, message: mapAuthErrorToMessage(error, 'signin') };
      }

      if (data?.session) {
        const loadResult = await fetchUserData(data.session, { allowRecoveryRetry: false });

        if (isFetchUserDataFailure(loadResult) || !loadResult.user) {
          const failure = isFetchUserDataFailure(loadResult) ? loadResult : null;
          console.error('Sign-in succeeded but account context could not be loaded', {
            email,
            authUserId: data.session.user.id,
            loadResult,
          });
          await supabase.auth.signOut();
          setUser(null);

          return {
            success: false,
            message: failure?.reason === 'missing_account'
              ? 'Sign-in succeeded, but no account profile was found. Please contact support.'
              : mapAuthErrorToMessage(failure?.error, 'account'),
          };
        }

        if (loadResult.user.role === 'customer' && loadResult.user.status === 'suspended') {
          await supabase.auth.signOut();
          setUser(null);
          return { success: false, message: 'Your account has been suspended. Please contact support.' };
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Unexpected customer login error', { email, error });
      return { success: false, message: mapAuthErrorToMessage(error, 'signin') };
    } finally {
      skipAuthListenerRef.current = false;
    }
  }, [fetchUserData]);

  // ─── Admin Login ──────────────────────────────────────────────────────

  const adminLogin = useCallback(async (email: string, password: string) => {
    try {
      const { data: checkResult, error: checkError } = await supabase.functions.invoke('check-admin-login', {
        body: { email },
      });
      if (checkError) throw checkError;
      if (!checkResult?.allowed) {
        return { success: false, message: checkResult?.message || 'You are not an admin user' };
      }
    } catch (error) {
      console.error('Admin pre-check failed', { email, error });
      return { success: false, message: mapAuthErrorToMessage(error, 'admin-check') };
    }

    skipAuthListenerRef.current = true;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        console.error('Admin sign-in failed', { email, error });
        return { success: false, message: mapAuthErrorToMessage(error, 'signin') };
      }

      if (data?.session) {
        const loadResult = await fetchUserData(data.session, { allowRecoveryRetry: false });

        if (isFetchUserDataFailure(loadResult) || !loadResult.user) {
          const failure = isFetchUserDataFailure(loadResult) ? loadResult : null;
          console.error('Admin sign-in succeeded but admin context failed to load', {
            email,
            authUserId: data.session.user.id,
            loadResult,
          });
          await supabase.auth.signOut();
          setUser(null);
          return {
            success: false,
            message: failure?.reason === 'missing_account'
              ? 'Sign-in succeeded, but your admin account record could not be found.'
              : mapAuthErrorToMessage(failure?.error, 'account'),
          };
        }

        if (loadResult.user.role !== 'admin') {
          await supabase.auth.signOut();
          setUser(null);
          return { success: false, message: 'This account does not have admin access.' };
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Unexpected admin login error', { email, error });
      return { success: false, message: mapAuthErrorToMessage(error, 'signin') };
    } finally {
      skipAuthListenerRef.current = false;
    }
  }, [fetchUserData]);

  // ─── Signup ───────────────────────────────────────────────────────────

  const signup = useCallback(async (data: { full_name: string; email: string; phone: string; password: string; referral_code?: string; username?: string }) => {
    const normalizedEmail = data.email.trim().toLowerCase();
    const cleanPhone = (data.phone || '').replace(/[\s-]/g, '');

    // ── Client-side validation ──
    if (!data.full_name.trim() || data.full_name.trim().length < 2) {
      return { success: false, message: 'Full name is required (at least 2 characters)' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizedEmail)) {
      return { success: false, message: 'A valid email address is required' };
    }
    if (!/^0[235]\d{8}$/.test(cleanPhone)) {
      return { success: false, message: 'Please enter a valid 10-digit phone number starting with 0.' };
    }
    const normalizedPhone = cleanPhone;
    if (!data.password || data.password.length < 6) {
      return { success: false, message: 'Password must be at least 6 characters' };
    }

    // ── Repair orphaned records that would block signup ──
    const runRepair = async () => {
      const { data: r, error } = await supabase.functions.invoke('repair-signup-blockers', {
        body: { email: normalizedEmail, phone: normalizedPhone },
      });
      if (error) return { blocked: false };
      if (r?.blocked) return { blocked: true, message: r.message };
      return { blocked: false };
    };

    const repair = await runRepair();
    if (repair.blocked) {
      return { success: false, message: repair.message || 'An active account with this email or phone already exists.' };
    }

    // ── Create auth user ──
    const doSignup = () =>
      supabase.auth.signUp({
        email: normalizedEmail,
        password: data.password,
        options: {
          data: {
            full_name: data.full_name.trim(),
            phone: normalizedPhone,
            referral_code: data.referral_code || '',
            username: data.username?.trim() || '',
          },
        },
      });

    let result = await doSignup();

    // If "already registered" — try repair once and retry
    if (result.error && /already\s+(registered|exists)/i.test(result.error.message)) {
      const retryRepair = await runRepair();
      if (retryRepair.blocked) {
        return { success: false, message: retryRepair.message || 'An active account with this email or phone already exists.' };
      }
      result = await doSignup();
    }

    if (result.error) {
      const msg = result.error.message || '';
      if (/email.*(required|invalid)/i.test(msg)) return { success: false, message: 'Please enter a valid email address' };
      if (/phone.*(required|invalid)/i.test(msg)) return { success: false, message: 'Please enter a valid phone number' };
      if (/already\s+(registered|exists)/i.test(msg)) return { success: false, message: 'An account with this email already exists' };
      if (/database error/i.test(msg)) return { success: false, message: 'Signup failed. Please check your details and try again.' };
      return { success: false, message: msg };
    }

    // ── Post-signup: determine verification mode ──
    // With auto_confirm_email=false, Supabase Auth handles confirmation natively.
    // auth-email-hook sends the branded confirmation email when verification is ON.
    // When verification is OFF, we force-confirm the user immediately.
    const userId = result.data?.user?.id;
    let needsVerification = false;

    if (userId) {
      const { data: verifySetting } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'require_email_verification')
        .maybeSingle();

      needsVerification = verifySetting?.value === 'true';

      if (!needsVerification) {
        // Verification is OFF → force-confirm the user so they can log in immediately
        try {
          await supabase.functions.invoke('confirm-user-email', {
            body: { user_id: userId },
          });
        } catch (e) {
          console.error('confirm-user-email failed:', e);
        }

        // Send welcome email (fire & forget)
        setTimeout(() => {
          supabase.rpc('get_my_customer_id').then(({ data: custId }) => {
            if (custId) {
              supabase.functions.invoke('send-transactional-email', {
                body: { template: 'welcome', customer_id: custId, data: {} },
              }).catch((e: unknown) => console.error('Welcome email error:', e));
            }
          });
        }, 2000);
      }
      // When verification is ON:
      // Supabase Auth has already triggered the signup webhook to auth-email-hook,
      // which sends the branded confirmation email. No custom function call needed.
      // Welcome email is sent after verification (triggered by verify-email-token).
    }

    // Sign out after signup so user must log in
    await supabase.auth.signOut();
    setUser(null);

    return { success: true, needsVerification, userId, email: normalizedEmail };
  }, []);

  // ─── Logout ───────────────────────────────────────────────────────────

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  // ─── Refresh ──────────────────────────────────────────────────────────

  const refreshUser = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    await fetchUserData(session);
  }, [fetchUserData]);

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, loading, login, adminLogin, signup, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
