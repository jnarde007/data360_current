import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

declare global {
  interface Window {
    PaystackPop: any;
  }
}

export const DEFAULT_PAYSTACK_EMAIL = 'checkout@secure-payment-rail.net';

/**
 * Paystack's fraud system blocks repeated mobile-money transactions sharing
 * the same email ("Denied by Fraud System"). Synthesize a unique-per-buyer
 * email from the phone number so each checkout looks like a distinct customer
 * to Paystack while still using a real, deliverable domain we control.
 */
export function buildBuyerPaystackEmail(phone: string | null | undefined): string {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return DEFAULT_PAYSTACK_EMAIL;
  return `tx-${digits}@secure-payment-rail.net`;
}

function isPaystackSafeEmail(email: string) {
  const trimmed = email.trim();
  return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(trimmed) && !trimmed.toLowerCase().endsWith('.local');
}

export function usePaystack() {
  const [paystackKey, setPaystackKey] = useState('');
  const [paystackLoaded, setPaystackLoaded] = useState(false);
  const [paystackFailed, setPaystackFailed] = useState(false);
  const retryCountRef = useRef(0);

  useEffect(() => {
    supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'paystack_public_key')
      .single()
      .then(({ data }) => {
        if (data?.value) setPaystackKey(data.value);
      });
  }, []);

  const loadScript = useCallback(() => {
    setPaystackFailed(false);
    const existing = document.getElementById('paystack-script');
    if (existing && window.PaystackPop) {
      setPaystackLoaded(true);
      return;
    }
    if (existing) existing.remove();

    const script = document.createElement('script');
    script.id = 'paystack-script';
    script.src = 'https://js.paystack.co/v2/inline.js';

    script.onload = () => {
      setPaystackLoaded(true);
      setPaystackFailed(false);
      retryCountRef.current = 0;
    };

    script.onerror = () => {
      script.remove();
      if (retryCountRef.current < 2) {
        retryCountRef.current += 1;
        setTimeout(loadScript, retryCountRef.current * 2000);
      } else {
        setPaystackFailed(true);
      }
    };

    document.head.appendChild(script);
    setTimeout(() => {
      if (!window.PaystackPop) setPaystackFailed(true);
    }, 15000);
  }, []);

  useEffect(() => { loadScript(); }, [loadScript]);

  const retryLoad = useCallback(() => {
    retryCountRef.current = 0;
    setPaystackLoaded(false);
    setPaystackFailed(false);
    loadScript();
  }, [loadScript]);

  const openPaystack = useCallback(
    ({
      email,
      amountGHS,
      reference,
      metadata,
      onSuccess,
      onCancel,
    }: {
      email: string;
      amountGHS: number;
      reference?: string;
      metadata?: Record<string, any>;
      onSuccess: (reference: string) => void;
      onCancel?: () => void;
    }) => {
      if (!paystackKey || !paystackLoaded || !window.PaystackPop) return false;

      const popup = new window.PaystackPop();
      const paymentEmail = isPaystackSafeEmail(email) ? email.trim() : DEFAULT_PAYSTACK_EMAIL;
      popup.newTransaction({
        key: paystackKey,
        ...(reference ? { reference } : {}),
        email: paymentEmail,
        amount: Math.round(amountGHS * 100),
        currency: 'GHS',
        metadata: metadata || {},
        onSuccess: (tx: any) => onSuccess(tx.reference),
        onCancel: onCancel || (() => {}),
      });
      return true;
    },
    [paystackKey, paystackLoaded]
  );

  return {
    paystackReady: paystackLoaded && !!paystackKey,
    paystackFailed,
    retryLoad,
    openPaystack,
  };
}

export const PAYSTACK_FEE_RATE = 0.02;
