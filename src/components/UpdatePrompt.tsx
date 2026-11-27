import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePwaUpdate } from '@/hooks/use-pwa-update';

/**
 * Floating update prompt for users stuck on stale caches.
 * - Hidden on checkout/payment routes
 * - Tapping "Update Now" purges caches/SW and reloads with cache-busting query
 * - Shows fallback message if update cannot complete
 */
const AUTO_DISMISS_MS = 8000;

export default function UpdatePrompt() {
  const { updateAvailable, manualState, onCheckoutRoute, forceUpdate, dismissUpdate } =
    usePwaUpdate();

  const visible = updateAvailable && !onCheckoutRoute;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) return;
    timerRef.current = setTimeout(() => {
      dismissUpdate();
    }, AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [visible, dismissUpdate]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="update-prompt"
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="fixed bottom-20 left-4 right-4 z-[60] sm:bottom-4 sm:left-4 sm:right-auto sm:max-w-sm"
          role="status"
          aria-live="polite"
        >
          <div className="bg-card border border-border rounded-2xl shadow-lg p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-foreground">Update available</p>
                <p className="text-xs text-muted-foreground truncate">
                  {manualState === 'failed'
                    ? 'Close and reopen the app to finish updating.'
                    : 'Tap to get the latest version'}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  size="sm"
                  onClick={forceUpdate}
                  disabled={manualState === 'updating'}
                  className="h-8 px-3 text-xs gap-1.5"
                >
                  {manualState === 'updating' ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Updating
                    </>
                  ) : (
                    'Update Now'
                  )}
                </Button>
                <button
                  onClick={dismissUpdate}
                  className="text-muted-foreground hover:text-foreground p-1"
                  aria-label="Dismiss update prompt"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
