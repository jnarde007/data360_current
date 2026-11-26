import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AttachmentRenderer } from '@/components/support/AttachmentRenderer';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2, ArrowLeft, Send, LifeBuoy, Paperclip, X,
  CheckCheck, Check, Clock
} from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';

interface Message {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_role: 'customer' | 'admin';
  message: string;
  attachment_url: string | null;
  read_at: string | null;
  created_at: string;
}

function formatDateDivider(dateStr: string) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'EEEE, MMM d, yyyy');
}

export default function SupportPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Fetch or initialize customer single thread
  const initChat = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data: tickets, error } = await supabase
        .from('support_tickets')
        .select('id, short_id, created_at, updated_at')
        .eq('customer_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (error) throw error;

      let tid: string;
      if (!tickets || tickets.length === 0) {
        const { data: newTicket, error: createErr } = await supabase
          .from('support_tickets')
          .insert({
            customer_id: user.id,
            subject: 'Customer Support',
            category: 'Other',
            message: 'Support conversation started',
            priority: 'medium',
          } as any)
          .select('id')
          .single();

        if (createErr) throw createErr;
        tid = newTicket.id;
      } else {
        tid = tickets[0].id;
      }

      setTicketId(tid);

      // Fetch messages for this ticket
      const { data: msgs, error: msgErr } = await supabase
        .from('support_messages')
        .select('*')
        .eq('ticket_id', tid)
        .order('created_at', { ascending: true });

      if (!msgErr && msgs) {
        setMessages(msgs as Message[]);
        setTimeout(() => scrollToBottom(false), 50);
      }

      // Mark admin messages as read
      await supabase.rpc('mark_support_messages_read', {
        p_ticket_id: tid,
        p_reader_role: 'customer'
      });
    } catch (err: any) {
      console.error('Error initializing chat:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id, scrollToBottom]);

  const refreshMessages = useCallback(async (tid: string, smooth = true) => {
    const { data: msgs, error } = await supabase
      .from('support_messages')
      .select('*')
      .eq('ticket_id', tid)
      .order('created_at', { ascending: true });

    if (!error && msgs) {
      setMessages(msgs as Message[]);
      setTimeout(() => scrollToBottom(smooth), 50);
      await supabase.rpc('mark_support_messages_read', {
        p_ticket_id: tid,
        p_reader_role: 'customer'
      });
    }
  }, [scrollToBottom]);

  useEffect(() => {
    initChat();
  }, [initChat]);

  // Realtime updates
  useRealtimeRefresh(
    ['support_messages', 'support_tickets'],
    () => {
      if (ticketId) refreshMessages(ticketId, true);
    },
    'customer-support-chat'
  );

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = replyText.trim();
    if ((!text && !attachment) || sending || !ticketId || !user?.id) return;

    setSending(true);
    let uploadedUrl: string | null = null;

    try {
      if (attachment) {
        const ext = attachment.name.split('.').pop() || 'bin';
        const filePath = `${user.id}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('support-attachments')
          .upload(filePath, attachment);

        if (!uploadErr) {
          const { data: urlData } = supabase.storage
            .from('support-attachments')
            .getPublicUrl(filePath);
          uploadedUrl = urlData?.publicUrl || null;
        }
      }

      const { data: newMsg, error: insertErr } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: ticketId,
          sender_id: user.id,
          sender_role: 'customer',
          message: text || (uploadedUrl ? 'Sent an attachment' : ''),
          attachment_url: uploadedUrl,
        } as any)
        .select()
        .single();

      if (insertErr) throw insertErr;

      setMessages(prev => [...prev, newMsg as Message]);
      setReplyText('');
      setAttachment(null);
      if (textareaRef.current) {
        textareaRef.current.style.height = '42px';
      }
      setTimeout(() => scrollToBottom(true), 50);
    } catch (err: any) {
      toast({
        title: 'Failed to send',
        description: err.message || 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setReplyText(e.target.value);
    const target = e.target;
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
  };

  // Group messages by date
  const groupedMessages = messages.reduce((acc, msg) => {
    const dateKey = msg.created_at ? format(new Date(msg.created_at), 'yyyy-MM-dd') : 'unknown';
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(msg);
    return acc;
  }, {} as Record<string, Message[]>);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground h-[100dvh] w-full overflow-hidden select-none">
      {/* 1. Locked Top WhatsApp Header */}
      <header className="h-14 md:h-16 px-3 md:px-4 bg-card/95 backdrop-blur-md border-b border-border/50 flex items-center justify-between shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/dashboard')}
            className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
            title="Back to Dashboard"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>

          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold text-sm shadow-inner">
              <LifeBuoy className="w-5 h-5" />
            </div>
            <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-card" />
          </div>

          <div>
            <h1 className="font-semibold text-foreground text-sm md:text-base leading-tight">DATA360 Support</h1>
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">Online • Instant Help</p>
          </div>
        </div>
      </header>

      {/* 2. Scrollable Messages Pane */}
      <main className="flex-1 overflow-y-auto px-3 py-4 md:px-6 space-y-4 bg-muted/20">
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <span>Loading support chat...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-center p-6">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-3">
              <LifeBuoy className="w-6 h-6" />
            </div>
            <p className="font-medium text-foreground text-sm">Welcome to DATA360 Support</p>
            <p className="text-xs text-muted-foreground max-w-xs mt-1">
              Have an issue with your order, wallet, or account? Type your message below to chat with our team.
            </p>
          </div>
        ) : (
          Object.entries(groupedMessages).map(([dateKey, msgs]) => (
            <div key={dateKey} className="space-y-3">
              {/* WhatsApp Date Chip */}
              <div className="flex justify-center my-2 sticky top-2 z-10">
                <span className="px-3 py-1 rounded-full text-[11px] font-medium bg-card/90 text-muted-foreground shadow-sm border border-border/40">
                  {formatDateDivider(msgs[0]?.created_at || dateKey)}
                </span>
              </div>

              {msgs.map((m) => {
                const isCustomer = m.sender_role === 'customer';
                return (
                  <div
                    key={m.id}
                    className={`flex w-full ${isCustomer ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`relative max-w-[85%] sm:max-w-md rounded-2xl px-3.5 py-2.5 shadow-sm text-sm break-words ${
                        isCustomer
                          ? 'bg-primary text-primary-foreground rounded-br-xs'
                          : 'bg-card text-foreground border border-border/50 rounded-bl-xs'
                      }`}
                    >
                      {!isCustomer && (
                        <p className="text-[11px] font-semibold text-primary mb-1">
                          Support Agent
                        </p>
                      )}

                      {m.attachment_url && (
                        <div className="mb-2 rounded-lg overflow-hidden">
                          <AttachmentRenderer url={m.attachment_url} />
                        </div>
                      )}

                      <p className="whitespace-pre-wrap leading-relaxed select-text">{m.message}</p>

                      <div
                        className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${
                          isCustomer ? 'text-primary-foreground/75' : 'text-muted-foreground'
                        }`}
                      >
                        <span>{m.created_at ? format(new Date(m.created_at), 'HH:mm') : ''}</span>
                        {isCustomer && (
                          m.read_at ? (
                            <CheckCheck className="w-3.5 h-3.5 text-sky-200" />
                          ) : (
                            <Check className="w-3.5 h-3.5 opacity-80" />
                          )
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* 3. Locked Bottom Composer */}
      <footer className="p-2 md:p-3 bg-card border-t border-border/50 shrink-0 shadow-lg pb-[max(0.6rem,env(safe-area-inset-bottom))]">
        {attachment && (
          <div className="flex items-center justify-between bg-muted/70 px-3 py-1.5 rounded-xl mb-2 text-xs max-w-4xl mx-auto border border-border/40">
            <span className="truncate text-foreground font-medium flex items-center gap-1.5">
              <Paperclip className="w-3.5 h-3.5 text-primary" />
              {attachment.name}
            </span>
            <button
              type="button"
              onClick={() => setAttachment(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <form onSubmit={handleSendMessage} className="flex items-end gap-2 max-w-4xl mx-auto">
          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.webp,.pdf"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) setAttachment(e.target.files[0]);
            }}
          />

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            className="h-10 w-10 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
            title="Attach file"
          >
            <Paperclip className="w-5 h-5" />
          </Button>

          <Textarea
            ref={textareaRef}
            rows={1}
            value={replyText}
            onChange={handleTextareaChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder="Type a message..."
            className="min-h-[42px] max-h-[120px] resize-none rounded-2xl bg-muted/40 border-border/50 text-sm py-2.5 px-4 focus-visible:ring-1 leading-relaxed"
          />

          <Button
            type="submit"
            disabled={(!replyText.trim() && !attachment) || sending}
            className="h-10 w-10 shrink-0 rounded-full p-0 flex items-center justify-center bg-primary hover:bg-primary/90 text-primary-foreground shadow-md transition-transform active:scale-95"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4 ml-0.5" />
            )}
          </Button>
        </form>
      </footer>
    </div>
  );
}
