import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { MessageCircle, X, Headphones, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { useToast } from '@/hooks/use-toast';

function useScrollDirection() {
  const [visible, setVisible] = useState(true);
  const lastY = useRef(0);
  const ticking = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const down = y > lastY.current && y > 80;
        lastY.current = y;
        if (down) {
          setVisible(false);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setVisible(true), 1200);
        } else {
          setVisible(true);
          clearTimeout(timer.current);
        }
        ticking.current = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      clearTimeout(timer.current);
    };
  }, []);

  return visible;
}

export function FloatingWhatsApp() {
  const location = useLocation();
  const isSupportPage = location.pathname.startsWith('/support') || location.pathname.startsWith('/admin/support');

  const [open, setOpen] = useState(false);
  const { toasts } = useToast();
  const hasActiveToast = toasts.some(t => t.open);
  const [supportUrl, setSupportUrl] = useState('');
  const [channelUrl, setChannelUrl] = useState('');
  const [loaded, setLoaded] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const scrollVisible = useScrollDirection();

  const fetchUrls = useCallback(() => {
    supabase
      .from('platform_settings')
      .select('key, value')
      .in('key', ['support_whatsapp_url', 'whatsapp_channel_url'])
      .then(({ data }) => {
        data?.forEach((r: { key: string; value: string }) => {
          if (r.key === 'support_whatsapp_url') setSupportUrl(r.value || '');
          if (r.key === 'whatsapp_channel_url') setChannelUrl(r.value || '');
        });
        setLoaded(true);
      });
  }, []);

  useEffect(() => { fetchUrls(); }, [fetchUrls]);
  useRealtimeRefresh(['platform_settings'], fetchUrls, 'whatsapp-settings');

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (isSupportPage) return null;
  if (loaded && !supportUrl && !channelUrl) return null;

  const shouldShow = !hasActiveToast && (scrollVisible || open);

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, scale: 0.8, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 12 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="fixed bottom-20 lg:bottom-6 right-3 lg:right-6 z-50 flex flex-col items-end gap-2"
        >
          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.9 }}
                transition={{ duration: 0.2 }}
                className="flex flex-col gap-2 mb-2"
              >
                {supportUrl && (
                  <a
                    href={supportUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 shadow-lg hover:shadow-xl transition-all hover:scale-[1.02] group min-w-[200px]"
                  >
                    <div className="w-9 h-9 rounded-full bg-[#25D366]/10 flex items-center justify-center shrink-0">
                      <Headphones className="w-4 h-4 text-[#25D366]" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">Chat Support</p>
                      <p className="text-[10px] text-muted-foreground">Talk to our team</p>
                    </div>
                  </a>
                )}
                {channelUrl && (
                  <a
                    href={channelUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 shadow-lg hover:shadow-xl transition-all hover:scale-[1.02] group min-w-[200px]"
                  >
                    <div className="w-9 h-9 rounded-full bg-[#25D366]/10 flex items-center justify-center shrink-0">
                      <Users className="w-4 h-4 text-[#25D366]" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">Join Channel</p>
                      <p className="text-[10px] text-muted-foreground">Get updates & offers</p>
                    </div>
                  </a>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setOpen(o => !o)}
            className={`w-10 h-10 lg:w-12 lg:h-12 rounded-full bg-[#25D366] text-white shadow-md hover:shadow-lg flex items-center justify-center transition-shadow ${!open ? 'wa-pulse' : ''}`}
            style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden' }}
            aria-label="WhatsApp"
          >
            <AnimatePresence mode="wait" initial={false}>
              {open ? (
                <motion.span key="close" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.15 }}>
                  <X className="w-4 h-4 lg:w-5 lg:h-5" />
                </motion.span>
              ) : (
                <motion.span key="wa" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.15 }}>
                  <MessageCircle className="w-4 h-4 lg:w-5 lg:h-5" />
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
