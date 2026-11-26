import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Info, AlertCircle } from "lucide-react";
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

  // Completely hide the banner on customer & admin support chat pages
  const isChatPage = location.pathname.startsWith('/support') || location.pathname.startsWith('/admin/support');
  if (isChatPage) return null;

  const [data, setData] = useState<AnnouncementData>({
    enabled: false,
    title: "",
    message: "",
    type: "warning",
  });
  const [isDialogOpen, setIsDialogOpen] = useState(false);

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

  if (!data.enabled || !data.message) {
    return null;
  }

  const getThemeClasses = () => {
    switch (data.type) {
      case "destructive":
        return {
          banner: "bg-rose-600 text-white border-b border-rose-700",
          badge: "bg-rose-950/40 text-rose-100 border border-rose-400/30",
          icon: <AlertCircle className="w-3.5 h-3.5 shrink-0" />,
        };
      case "info":
        return {
          banner: "bg-sky-600 text-white border-b border-sky-700",
          badge: "bg-sky-950/40 text-sky-100 border border-sky-400/30",
          icon: <Info className="w-3.5 h-3.5 shrink-0" />,
        };
      case "warning":
      default:
        return {
          banner: "bg-amber-500 text-amber-950 border-b border-amber-600",
          badge: "bg-amber-950/20 text-amber-950 border border-amber-950/20 font-bold",
          icon: <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-950" />,
        };
    }
  };

  const theme = getThemeClasses();

  return (
    <>
      <div
        onClick={() => setIsDialogOpen(true)}
        className={`sticky top-0 z-50 flex items-center h-8 md:h-9 px-3 text-xs shadow-xs cursor-pointer select-none overflow-hidden transition-colors ${theme.banner}`}
        title="Tap to read full announcement"
      >
        <div className="flex items-center gap-1.5 shrink-0 pr-3 z-10 font-bold">
          {theme.icon}
          <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${theme.badge}`}>
            {data.title || "UPDATE"}
          </span>
        </div>

        <div className="flex-1 overflow-hidden relative whitespace-nowrap">
          <div className="animate-ticker-marquee font-medium">
            <span>{data.message}</span>
            <span className="mx-8 opacity-40">•</span>
            <span>{data.message}</span>
          </div>
        </div>

        <div className="hidden sm:block text-[10px] uppercase font-semibold opacity-80 shrink-0 pl-2">
          Tap for details
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {theme.icon}
              <span>{data.title || "Announcement"}</span>
            </DialogTitle>
            <DialogDescription className="text-foreground whitespace-pre-wrap leading-relaxed pt-2">
              {data.message}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}
