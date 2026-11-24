import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Smartphone, Share, Plus, MoreVertical, Download, Apple, Check, Monitor } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const OPEN_EVENT = "data360:open-install-help";

/** Programmatically open the install help modal from anywhere in the app. */
export function openInstallHelp() {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

type Platform = "android" | "ios" | "desktop";

function detectPlatform(): Platform {
  if (typeof window === "undefined") return "desktop";
  const ua = window.navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

interface StepProps {
  num: number;
  icon: React.ReactNode;
  title: string;
  detail?: string;
}

const Step = ({ num, icon, title, detail }: StepProps) => (
  <div className="flex items-start gap-3 p-3 rounded-2xl bg-muted/50 border border-border/40">
    <div className="relative w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 text-primary">
      {icon}
      <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
        {num}
      </span>
    </div>
    <div className="min-w-0 flex-1">
      <p className="font-medium text-sm text-foreground leading-snug">{title}</p>
      {detail && <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>}
    </div>
  </div>
);

export default function InstallHelpDialog() {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<Platform>("desktop");
  const [installed, setInstalled] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [activeTab, setActiveTab] = useState<Platform>("android");

  useEffect(() => {
    const p = detectPlatform();
    setPlatform(p);
    setActiveTab(p === "desktop" ? "android" : p);
    setInstalled(isStandalone());

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    const onInstalled = () => setInstalled(true);
    window.addEventListener("appinstalled", onInstalled);

    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  const handleNativeInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md rounded-3xl p-0 overflow-hidden">
        <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-transparent px-6 pt-6 pb-4">
          <DialogHeader className="space-y-2">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center mb-1">
              <Download className="w-7 h-7 text-primary" />
            </div>
            <DialogTitle className="font-display text-xl text-center">Install DATA360</DialogTitle>
            <DialogDescription className="text-center text-sm">
              Add DATA360 to your home screen for one-tap access, faster loads, and a full-app experience.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 pb-6 pt-2">
          {installed ? (
            <div className="text-center space-y-3 py-4">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/15 flex items-center justify-center">
                <Check className="w-6 h-6 text-primary" />
              </div>
              <p className="font-semibold text-foreground">DATA360 is already installed</p>
              <p className="text-sm text-muted-foreground">
                Look for the DATA360 icon on your home screen or app drawer.
              </p>
              <Button onClick={() => setOpen(false)} className="w-full">
                Got it
              </Button>
            </div>
          ) : (
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Platform)}>
              <TabsList className="grid w-full grid-cols-2 rounded-xl">
                <TabsTrigger value="android" className="rounded-lg gap-1.5">
                  <Smartphone className="w-4 h-4" /> Android
                </TabsTrigger>
                <TabsTrigger value="ios" className="rounded-lg gap-1.5">
                  <Apple className="w-4 h-4" /> iPhone
                </TabsTrigger>
              </TabsList>

              {/* Android Chrome */}
              <TabsContent value="android" className="space-y-2.5 mt-4">
                {deferredPrompt ? (
                  <>
                    <p className="text-xs text-muted-foreground text-center">
                      Tap below to install instantly with Chrome.
                    </p>
                    <Button onClick={handleNativeInstall} className="w-full" size="lg">
                      <Download className="w-4 h-4 mr-2" />
                      Install DATA360
                    </Button>
                    <div className="relative my-2">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-border/60" />
                      </div>
                      <div className="relative flex justify-center text-[10px] uppercase tracking-wider">
                        <span className="bg-background px-2 text-muted-foreground">Or do it manually</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground mb-1">
                    Open this page in <strong>Google Chrome</strong> on your Android phone, then:
                  </p>
                )}
                <Step num={1} icon={<MoreVertical className="w-5 h-5" />} title="Tap the menu (⋮)" detail="Top-right corner of Chrome" />
                <Step num={2} icon={<Download className="w-5 h-5" />} title='Tap "Install app"' detail='or "Add to Home screen"' />
                <Step num={3} icon={<Check className="w-5 h-5" />} title='Confirm "Install"' detail="DATA360 will appear in your app drawer & home screen" />
                <p className="text-[11px] text-muted-foreground text-center pt-1">
                  Tip: if you don't see "Install app", make sure you're using Chrome (not Facebook/Instagram in-app browser).
                </p>
              </TabsContent>

              {/* iOS Safari */}
              <TabsContent value="ios" className="space-y-2.5 mt-4">
                <p className="text-xs text-muted-foreground mb-1">
                  Open this page in <strong>Safari</strong> (not Chrome) on your iPhone or iPad, then:
                </p>
                <Step num={1} icon={<Share className="w-5 h-5" />} title="Tap the Share button" detail="The square with an upward arrow at the bottom of Safari" />
                <Step num={2} icon={<Plus className="w-5 h-5" />} title='Choose "Add to Home Screen"' detail="Scroll the share sheet down if you don't see it" />
                <Step num={3} icon={<Check className="w-5 h-5" />} title='Tap "Add"' detail="DATA360 will appear on your home screen" />
                <p className="text-[11px] text-muted-foreground text-center pt-1">
                  iOS only allows installing from Safari — other browsers won't show this option.
                </p>
              </TabsContent>
            </Tabs>
          )}

          {!installed && platform === "desktop" && (
            <div className="mt-4 flex items-start gap-2 p-3 rounded-xl bg-muted/40 border border-border/40">
              <Monitor className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                You're on desktop. To install on your phone, open <strong>buy-data360.com</strong> in
                your phone's browser and follow the steps above.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
