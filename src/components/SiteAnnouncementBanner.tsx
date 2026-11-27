import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Info, AlertCircle, ChevronRight, X } from "lucide-react";
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
          pill: "bg-rose-600 text-white hover:bg-rose-700 shadow-xs border border-rose-500",
        };
      case "info":
        return {
          banner: "bg-sky-500/15 dark:bg-sky-950/40 text-sky-950 dark:text-sky-200 border-b border-sky-500/30 backdrop-blur-xs",
          badge: "bg-sky-600 text-white font-bold",
          icon: <Info className="w-3.5 h-3.5 shrink-0 text-sky-600 dark:text-sky-400" />,
          pill: "bg-sky-600 text-white hover:bg-sky-700 shadow-xs border border-sky-500",
        };
      case "warning":
      default:
        return {
          banner: "bg-amber-500/15 dark:bg-amber-950/40 text-amber-950 dark:text-amber-200 border-b border-amber-500/30 backdrop-blur-xs",
          badge: "bg-amber-500 text-amber-950 font-bold",
          icon: <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400" />,
          pill: "bg-amber-950 text-white dark:bg-amber-400 dark:text-amber-950 hover:opacity-90 shadow-xs border border-amber-950/20",
        };
    }
  };

  const theme = getTheme();

  if (location.pathname.startsWith('/admin')) {
    return null;
  }

  return (<>
      <div
        onClick={() => setIsDialogOpen(true)}
        className={"sticky top-0 z-50 flex items-center h-9 sm:h-10 px-3 text-xs select-none transition-all duration-200 shadow-2xs cursor-pointer " + theme.banner}
        title="Tap or click to read full announcement"
      >
        <div className="flex items-center justify-between gap-2.5 w-full">
          
          {/* Left badge */}
          <div className="flex items-center gap-1.5 shrink-0 font-bold z-10 pr-1">
            {theme.icon}
            <span className={"text-[10px] tracking-wide uppercase px-2 py-0.5 rounded-full " + theme.badge}>
              {data.title || "UPDATE"}
            </span>
          </div>

          {/* Scrolling Marquee on BOTH PC and Phone: Starts immediately at 0%, full width on phone */}
          <div className="flex-1 overflow-hidden relative whitespace-nowrap">
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

          {/* Eye-catching "Tap for details" Pill Button - Shown ONLY on computer/desktop */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsDialogOpen(true);
            }}
            className={"hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold tracking-tight cursor-pointer transition-all duration-150 hover:scale-105 active:scale-95 shrink-0 " + theme.pill}
            title="Read full announcement details"
          >
            <span>Tap for details</span>
            <ChevronRight className="w-3 h-3 -mr-0.5 stroke-[2.5]" />
          </button>

          {/* Dismiss button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setDismissed(true);
            }}
            className="shrink-0 p-1 -mr-1 rounded-md opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
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
