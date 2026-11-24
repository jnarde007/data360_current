import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Smartphone, Download, Share, MoreVertical, Plus } from "lucide-react";
import { Link } from "react-router-dom";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const InstallPage = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if running in standalone mode
    setIsStandalone(window.matchMedia("(display-mode: standalone)").matches);

    // Detect iOS
    const ua = window.navigator.userAgent;
    const iOS = /iPad|iPhone|iPod/.test(ua);
    setIsIOS(iOS);

    // Listen for beforeinstallprompt event (Android/Desktop)
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === "accepted") {
      setDeferredPrompt(null);
    }
  };

  if (isStandalone) {
    return (
      <div className="min-h-screen premium-app-shell flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center">
          <CardHeader>
            <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Smartphone className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="font-display text-2xl">Already Installed!</CardTitle>
            <CardDescription>
              DATA360 is already running as an app on your device.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/dashboard">
              <Button className="w-full">Go to Dashboard</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen premium-app-shell flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto w-20 h-20 bg-primary/10 rounded-2xl flex items-center justify-center mb-4">
            <Download className="w-10 h-10 text-primary" />
          </div>
          <CardTitle className="font-display text-2xl">Install DATA360</CardTitle>
          <CardDescription>
            Add DATA360 to your home screen for quick access and a better experience.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Android / Desktop - Native install prompt */}
          {deferredPrompt && (
            <Button onClick={handleInstall} className="w-full" size="lg">
              <Download className="w-5 h-5 mr-2" />
              Install App
            </Button>
          )}

          {/* iOS Instructions */}
          {isIOS && !deferredPrompt && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">
                To install on iPhone or iPad:
              </p>
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                  <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center shrink-0">
                    <Share className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">1. Tap the Share button</p>
                    <p className="text-xs text-muted-foreground">At the bottom of Safari</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                  <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center shrink-0">
                    <Plus className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">2. Select "Add to Home Screen"</p>
                    <p className="text-xs text-muted-foreground">Scroll down if needed</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                  <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center shrink-0">
                    <Smartphone className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">3. Tap "Add"</p>
                    <p className="text-xs text-muted-foreground">DATA360 will appear on your home screen</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Android fallback instructions */}
          {!isIOS && !deferredPrompt && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">
                To install on Android:
              </p>
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                  <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center shrink-0">
                    <MoreVertical className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">1. Tap the menu (⋮)</p>
                    <p className="text-xs text-muted-foreground">Top right of Chrome</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                  <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center shrink-0">
                    <Download className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">2. Select "Install app" or "Add to Home screen"</p>
                    <p className="text-xs text-muted-foreground">The app will be installed</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="pt-4 border-t">
            <Link to="/">
              <Button variant="outline" className="w-full">
                Continue in Browser
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default InstallPage;
