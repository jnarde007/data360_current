import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Info, AlertCircle, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface AnnouncementData {
  enabled: boolean;
  title: string;
  message: string;
  type: "warning" | "destructive" | "info";
}

export function SiteAnnouncementBanner() {
  const location = useLocation();

  // Hide on support chat routes
  const isChatPage = location.pathname.startsWith('/support') || location.pathname.startsWith('/admin/support');
  if (isChatPage) return null;

  const [data, setData] = useState<AnnouncementData>({
    enabled: false,
    title: "",
    message: "",
    type: "warning",
  });
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetchAnnouncement();
  }, [location.pathname]);

  const fetchAnnouncement = async () => {
    try {
      const { data: rows, error } = await supabase
        .from("platform_settings")
        .select("key, value")
        .in("key", [
          "announcement_enabled",
          "announcement_title",
          "announcement_message",
          "announcement_type",
        ]);

      if (error) throw error;

      if (rows) {
        const rowMap = new Map(rows.map((r) => [r.key, r.value]));
        setData({
          enabled: rowMap.get("announcement_enabled") === "true",
          title: rowMap.get("announcement_title") || "NOTICE",
          message: rowMap.get("announcement_message") || "",
          type: (rowMap.get("announcement_type") as any) || "warning",
        });
      }
    } catch (err) {
      console.error("Failed to fetch announcement:", err);
    }
  };

  if (!data.enabled || !data.message || dismissed) {
    return null;
  }

  const getTheme = () => {
    switch (data.type) {
      case "destructive":
        return {
          banner: "bg-rose-500/15 dark:bg-rose-950/40 text-rose-950 dark:text-rose-200 border-b border-rose-500/30 backdrop-blur-xs",
          badge: "bg-rose-500 text-white font-bold",
          icon: <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600 dark:text-rose-400" />,
        };
      case "info":
        return {
          banner: "bg-sky-500/15 dark:bg-sky-950/40 text-sky-950 dark:text-sky-200 border-b border-sky-500/30 backdrop-blur-xs",
          badge: "bg-sky-600 text-white font-bold",
          icon: <Info className="w-3.5 h-3.5 shrink-0 text-sky-600 dark:text-sky-400" />,
        };
      case "warning":
      default:
        return {
          banner: "bg-amber-500/15 dark:bg-amber-950/40 text-amber-950 dark:text-amber-200 border-b border-amber-500/30 backdrop-blur-xs",
          badge: "bg-amber-500 text-amber-950 font-bold",
          icon: <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400" />,
        };
    }
  };

  const theme = getTheme();

  return (
    <>
      <div
        className={"sticky top-0 z-50 flex items-center h-9 sm:h-10 px-3 text-xs select-none transition-all duration-200 shadow-2xs " + theme.banner}
        title="Tap or click to read full announcement"
      >
        <div className="flex items-center justify-between gap-2.5 w-full">
          
          {/* Left badge */}
          <div 
            onClick={() => setIsDialogOpen(true)}
            className="flex items-center gap-1.5 shrink-0 font-bold z-10 cursor-pointer pr-1"
          >
            {theme.icon}
            <span className={"text-[10px] tracking-wide uppercase px-2 py-0.5 rounded-full " + theme.badge}>
              {data.title || "UPDATE"}
            </span>
          </div>

          {/* Scrolling Marquee on BOTH PC and Phone: Starts immediately at 0%, seamless loop, never empty */}
          <div 
            onClick={() => setIsDialogOpen(true)}
            className="flex-1 overflow-hidden relative whitespace-nowrap cursor-pointer"
          >
            <div className="animate-ticker-marquee font-medium text-xs sm:text-[13px] inline-flex items-center">
              {/* Half 1 */}
              <span className="inline-flex items-center">
                <span>{data.message}</span>
                <span className="mx-8 opacity-40">•</span>
                <span>{data.message}</span>
                <span className="mx-8 opacity-40">•</span>
              </span>
              {/* Half 2 (seamless duplicate for infinite continuous scroll) */}
              <span className="inline-flex items-center" aria-hidden="true">
                <span>{data.message}</span>
                <span className="mx-8 opacity-40">•</span>
                <span>{data.message}</span>
                <span className="mx-8 opacity-40">•</span>
              </span>
            </div>
          </div>

          {/* Right helper text on PC */}
          <div 
            onClick={() => setIsDialogOpen(true)}
            className="hidden sm:block text-[10px] uppercase font-semibold opacity-70 shrink-0 cursor-pointer pl-2 hover:opacity-100"
          >
            Tap for details
          </div>

          {/* Dismiss button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setDismissed(true);
            }}
            className="shrink-0 p-1 -mr-1 rounded-md opacity-60 hover:opacity-100 transition-opacity"
            aria-label="Dismiss banner"
            title="Dismiss notice"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {theme.icon}
              <span>{data.title || "Announcement"}</span>
            </DialogTitle>
            <DialogDescription className="text-foreground whitespace-pre-wrap leading-relaxed pt-2 text-sm">
              {data.message}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}
