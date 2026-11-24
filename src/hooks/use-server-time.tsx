import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Fetches server time and computes offset (serverMs - clientMs).
 * Use `serverNow()` for a server-aligned timestamp.
 */
let cachedOffset: number | null = null;
let fetchPromise: Promise<number> | null = null;
let lastSyncMs = 0;

const RESYNC_INTERVAL_MS = 60_000;
const RETRY_DELAY_MS = 1_500;

async function fetchOffset(): Promise<number> {
  const beforeMs = Date.now();
  const { data, error } = await supabase.functions.invoke('server-time');
  const afterMs = Date.now();

  if (error) throw error;

  const serverNowMs = Number(data?.server_now_ms);
  if (!Number.isFinite(serverNowMs)) {
    throw new Error('Invalid server time response');
  }

  // Account for network latency by using the midpoint.
  const roundTripMs = afterMs - beforeMs;
  const estimatedServerNow = serverNowMs + roundTripMs / 2;
  return estimatedServerNow - afterMs;
}

export async function syncServerTime(force = false): Promise<number> {
  const hasFreshCache = cachedOffset !== null && Date.now() - lastSyncMs < RESYNC_INTERVAL_MS;
  if (!force && hasFreshCache) return cachedOffset!;

  if (!fetchPromise) {
    fetchPromise = fetchOffset()
      .then((offset) => {
        cachedOffset = offset;
        lastSyncMs = Date.now();
        return offset;
      })
      .finally(() => {
        fetchPromise = null;
      });
  }

  return fetchPromise;
}

/** Returns current time aligned to server clock */
export function serverNow(): number {
  return Date.now() + (cachedOffset ?? 0);
}

export function isServerTimeReady(): boolean {
  return cachedOffset !== null;
}

export function useServerTimeSync(options: { autoRefresh?: boolean } = {}) {
  const { autoRefresh = false } = options;
  const [ready, setReady] = useState(isServerTimeReady());

  useEffect(() => {
    let mounted = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const attemptSync = async () => {
      try {
        await syncServerTime(true);
        if (mounted) setReady(true);
      } catch {
        if (!mounted) return;
        retryTimer = setTimeout(() => {
          void attemptSync();
        }, RETRY_DELAY_MS);
      }
    };

    if (!isServerTimeReady()) {
      void attemptSync();
    } else {
      setReady(true);
    }

    let refreshTimer: ReturnType<typeof setInterval> | null = null;
    if (autoRefresh) {
      refreshTimer = setInterval(() => {
        void syncServerTime(true).catch(() => {
          // Keep the last good offset if a periodic refresh fails.
        });
      }, RESYNC_INTERVAL_MS);
    }

    return () => {
      mounted = false;
      if (retryTimer) clearTimeout(retryTimer);
      if (refreshTimer) clearInterval(refreshTimer);
    };
  }, [autoRefresh]);

  return { ready, serverNow };
}
