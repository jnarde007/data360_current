import { useCallback, useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { toast } from 'sonner';
import { APP_CACHE_ID, APP_VERSION } from '@/lib/app-version';

const CURRENT_VERSION = APP_VERSION;
const CURRENT_CACHE_ID = APP_CACHE_ID;
const UPDATE_QUERY_KEY = '__data360_v';
const UPDATE_TOAST_ID = 'data360-update-available';
const APPLIED_VERSION_KEY = 'data360-applied-version';
const RELOAD_IN_PROGRESS_KEY = 'data360-reload-in-progress';
const MANUAL_RELOAD_ATTEMPT_KEY = 'data360-manual-reload-attempt';
const DISMISSED_VERSION_KEY = 'data360-dismissed-update';
const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const DEFERRED_RELOAD_CHECK_MS = 2000;

const CHECKOUT_ROUTE_PATTERNS = [
  /^\/buy-data/,
  /^\/topup/,
  /^\/afa/,
  /^\/checker/,
  /^\/guest-buy/,
  /^\/guest\/success/,
  /^\/guest\/afa/,
  /^\/guest\/checker/,
];

export const isOnCheckoutRoute = () =>
  CHECKOUT_ROUTE_PATTERNS.some((p) => p.test(window.location.pathname));

const isPreviewOrIframe = () => {
  const isPreviewHost =
    window.location.hostname.includes('id-preview--') ||
    window.location.hostname.includes('lovableproject.com');

  try {
    return isPreviewHost || window.self !== window.top;
  } catch {
    return true;
  }
};

const clearOldAppCaches = async (keepCacheId = CURRENT_CACHE_ID) => {
  if (!('caches' in window)) return;

  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames.map((name) => {
      const isData360Cache =
        name.includes('data360') ||
        name === 'html-cache' ||
        name === 'static-assets' ||
        name === 'image-cache' ||
        name.startsWith('workbox-');
      const isCurrentCache = keepCacheId ? name.includes(keepCacheId) : false;
      return isData360Cache && !isCurrentCache ? caches.delete(name) : Promise.resolve(false);
    }),
  );
};

const clearAllAppCaches = async () => {
  if (!('caches' in window)) return;
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map((name) => caches.delete(name).catch(() => false)));
};

const unregisterExistingServiceWorkers = async () => {
  if (!('serviceWorker' in navigator)) return;

  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations.map(async (registration) => {
      try {
        registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
        await registration.unregister();
      } catch {
        // Ignore cleanup failures
      }
    }),
  );
};

const prepareFreshAppShell = async (targetCacheId?: string) => {
  await clearOldAppCaches(targetCacheId || CURRENT_CACHE_ID);
  await unregisterExistingServiceWorkers();
  await clearOldAppCaches(targetCacheId || CURRENT_CACHE_ID);
};

const versionedReloadUrl = (targetVersion?: string) => {
  const url = new URL(window.location.href);
  url.searchParams.set(UPDATE_QUERY_KEY, targetVersion || Date.now().toString());
  return url.toString();
};

const reloadPairFor = (targetVersion: string) => `${CURRENT_VERSION}->${targetVersion}`;

const canAutoReloadForVersion = (targetVersion?: string) => {
  if (!targetVersion || targetVersion === CURRENT_VERSION) return false;
  const pair = reloadPairFor(targetVersion);

  try {
    return sessionStorage.getItem(RELOAD_IN_PROGRESS_KEY) !== pair;
  } catch {
    return true;
  }
};

const markAutoReloadStarted = (targetVersion: string) => {
  const pair = reloadPairFor(targetVersion);
  try {
    sessionStorage.setItem(RELOAD_IN_PROGRESS_KEY, pair);
  } catch {
    // Storage can be unavailable
  }
};

const markCurrentVersionHealthy = () => {
  try {
    localStorage.setItem(APPLIED_VERSION_KEY, CURRENT_VERSION);
    sessionStorage.removeItem(RELOAD_IN_PROGRESS_KEY);
    sessionStorage.removeItem(MANUAL_RELOAD_ATTEMPT_KEY);
  } catch {
    // Storage can be unavailable
  }
};

type ManualUpdateState = 'idle' | 'updating' | 'failed';

interface PwaUpdateApi {
  updateAvailable: boolean;
  latestVersion: string | null;
  manualState: ManualUpdateState;
  onCheckoutRoute: boolean;
  forceUpdate: () => Promise<void>;
  dismissUpdate: () => void;
}

export function usePwaUpdate(): PwaUpdateApi {
  const reloadDeferredRef = useRef(false);
  const reloadStartedRef = useRef(false);
  const pendingVersionRef = useRef<string | undefined>();
  const pendingCacheIdRef = useRef<string | undefined>();
  const versionCheckInFlightRef = useRef(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [manualState, setManualState] = useState<ManualUpdateState>('idle');
  const [onCheckoutRoute, setOnCheckoutRoute] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return isOnCheckoutRoute();
  });

  const announceUpdate = (targetVersion?: string, targetCacheId?: string) => {
    if (targetVersion) pendingVersionRef.current = targetVersion;
    if (targetCacheId) pendingCacheIdRef.current = targetCacheId;
    setLatestVersion(targetVersion || pendingVersionRef.current || `pending-${Date.now()}`);
    setUpdateAvailable(true);
  };

  const checkRemoteVersion = async () => {
    if (versionCheckInFlightRef.current) return;
    versionCheckInFlightRef.current = true;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(`/version.json?t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          Pragma: 'no-cache',
        },
        signal: controller.signal,
      });
      if (!response.ok) return;

      const remote = (await response.json()) as { version?: string; cacheId?: string };
      if (!remote.version) return;
      if (remote.version === CURRENT_VERSION) {
        markCurrentVersionHealthy();
        // Do NOT clear an already-announced update — the SW may have swapped
        // the bundle so remote==current even though the rendered HTML is stale.
        // Only suppress when nothing has been announced yet.
        if (!pendingVersionRef.current) {
          setUpdateAvailable(false);
          setLatestVersion(null);
        }
        return;
      }

      announceUpdate(remote.version, remote.cacheId);
    } catch {
      // Ignore transient errors
    } finally {
      window.clearTimeout(timeout);
      versionCheckInFlightRef.current = false;
    }
  };

  const runUpdateCheck = () => {
    registrationRef.current?.update().catch(() => undefined);
    checkRemoteVersion();
  };

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      registrationRef.current = registration;
      registration.update().catch(() => undefined);
      registration.waiting?.postMessage({ type: 'SKIP_WAITING' });

      const handleUpdateFound = () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && registration.waiting) {
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      };
      registration.addEventListener('updatefound', handleUpdateFound);
    },
  });

  const forceUpdate = useCallback(async () => {
    if (manualState === 'updating') return;

    if (isOnCheckoutRoute()) {
      toast.info('Update available', {
        id: UPDATE_TOAST_ID,
        description: 'Please complete your payment first, then refresh.',
        duration: 8000,
      });
      return;
    }

    setManualState('updating');

    let attempt = 0;
    try {
      attempt = Number(sessionStorage.getItem(MANUAL_RELOAD_ATTEMPT_KEY) || '0') + 1;
      sessionStorage.setItem(MANUAL_RELOAD_ATTEMPT_KEY, String(attempt));
    } catch {
      attempt = 1;
    }

    try {
      // Try to refresh remote version one more time
      try {
        const response = await fetch(`/version.json?t=${Date.now()}`, {
          cache: 'no-store',
        });
        if (response.ok) {
          const remote = (await response.json()) as { version?: string; cacheId?: string };
          if (remote.version) {
            pendingVersionRef.current = remote.version;
            pendingCacheIdRef.current = remote.cacheId;
          }
        }
      } catch {
        // Ignore — proceed with full purge
      }

      const targetVersion = pendingVersionRef.current || `${Date.now()}`;
      const targetCacheId = pendingCacheIdRef.current;

      // Aggressive cleanup
      await unregisterExistingServiceWorkers();
      await clearAllAppCaches();
      await prepareFreshAppShell(targetCacheId);

      // Mark this auto-reload pair so the post-reload guard doesn't loop
      try {
        markAutoReloadStarted(targetVersion);
      } catch {
        // ignore
      }

      reloadStartedRef.current = true;
      window.location.replace(versionedReloadUrl(targetVersion));
    } catch {
      setManualState('failed');
      if (attempt >= 2) {
        toast.error('Update could not complete', {
          description: 'Please close and reopen the app to finish updating.',
          duration: 12000,
        });
      } else {
        toast.error('Update failed', {
          description: 'Please try again in a moment.',
          duration: 8000,
        });
      }
    }
  }, [manualState]);

  useEffect(() => {
    if (isPreviewOrIframe()) return;

    runUpdateCheck();

    const interval = window.setInterval(runUpdateCheck, VERSION_CHECK_INTERVAL_MS);
    const deferredReloadInterval = window.setInterval(() => {
      setOnCheckoutRoute(isOnCheckoutRoute());
    }, DEFERRED_RELOAD_CHECK_MS);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') runUpdateCheck();
    };

    const handlePageShow = () => runUpdateCheck();

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', runUpdateCheck);
    window.addEventListener('online', runUpdateCheck);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      window.clearInterval(interval);
      window.clearInterval(deferredReloadInterval);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', runUpdateCheck);
      window.removeEventListener('online', runUpdateCheck);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);

  useEffect(() => {
    if (needRefresh) {
      // A new SW is waiting/installed — surface the prompt. Do NOT auto-swap
      // (updateServiceWorker(false) would silently activate without UI).
      if (!pendingVersionRef.current) {
        pendingVersionRef.current = `sw-update-${Date.now()}`;
      }
      announceUpdate(pendingVersionRef.current, pendingCacheIdRef.current);
    }
  }, [needRefresh]);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || isPreviewOrIframe()) return;

    const handleControllerChange = () => {
      // SW took control — surface the prompt so user can refresh on demand.
      if (!pendingVersionRef.current) {
        pendingVersionRef.current = `sw-controller-${Date.now()}`;
      }
      announceUpdate(pendingVersionRef.current, pendingCacheIdRef.current);
    };

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  const dismissUpdate = useCallback(() => {
    try {
      const version = latestVersion || pendingVersionRef.current;
      if (version) {
        sessionStorage.setItem(DISMISSED_VERSION_KEY, version);
      }
    } catch {
      // Storage can be unavailable
    }
    setUpdateAvailable(false);
  }, [latestVersion]);

  return {
    updateAvailable,
    latestVersion,
    manualState,
    onCheckoutRoute,
    forceUpdate,
    dismissUpdate,
  };
}
