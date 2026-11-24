import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, X, Share, Plus, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { openInstallHelp } from '@/components/InstallHelpDialog';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  useEffect(() => {
    // Don't show if already installed or dismissed this session
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const dismissed = sessionStorage.getItem('install-banner-dismissed');
    
    if (isStandalone || dismissed) return;

    // Detect iOS
    const ua = window.navigator.userAgent;
    const iOS = /iPad|iPhone|iPod/.test(ua);
    setIsIOS(iOS);

    // Show banner for iOS after a delay
    if (iOS) {
      const timer = setTimeout(() => setShowBanner(true), 3000);
      return () => clearTimeout(timer);
    }

    // Listen for install prompt on Android/Desktop
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setTimeout(() => setShowBanner(true), 3000);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    // On Android with a deferred prompt, fire the native install prompt directly
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setShowBanner(false);
      }
      setDeferredPrompt(null);
      return;
    }
    // iOS or no native prompt available — open the help modal with platform-aware steps
    openInstallHelp();
  };

  const handleDismiss = () => {
    setShowBanner(false);
    setShowIOSInstructions(false);
    sessionStorage.setItem('install-banner-dismissed', 'true');
  };

  if (!showBanner) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="fixed bottom-4 left-4 right-4 z-50 sm:left-auto sm:right-4 sm:max-w-sm"
      >
        <div className="bg-card border border-border rounded-2xl shadow-lg p-4">
          {showIOSInstructions ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between">
                <p className="font-semibold text-sm text-foreground">Add to Home Screen</p>
                <button onClick={handleDismiss} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Share className="w-4 h-4 text-primary flex-shrink-0" />
                  <span>1. Tap the <strong>Share</strong> button below</span>
                </div>
                <div className="flex items-center gap-2">
                  <Plus className="w-4 h-4 text-primary flex-shrink-0" />
                  <span>2. Select <strong>Add to Home Screen</strong></span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Download className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-foreground">Install DATA360</p>
                <p className="text-xs text-muted-foreground truncate">Add to home screen for quick access</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button size="sm" onClick={handleInstall} className="h-8 px-3 text-xs">
                  Install
                </Button>
                <button onClick={handleDismiss} className="text-muted-foreground hover:text-foreground p-1">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
