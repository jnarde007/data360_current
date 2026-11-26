import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AttachmentRenderer } from '@/components/support/AttachmentRenderer';
import { useToast } from '@/hooks/use-toast';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import {
  Loader2, ArrowLeft, Send, LifeBuoy, MoreVertical, Trash2, Paperclip, Check, CheckCheck, X, Package
} from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';
import { useNavigate, useSearchParams } from 'react-router-dom';

interface Message {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_role: string;
  message: string;
  attachment_url: string | null;
  created_at: string;
  read_at: string | null;
}

interface OrderContext {
  shortId: string;
  id: string;
  network?: string;
  volume?: string;
  phone?: string;
  status?: string;
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
  const [searchParams, setSearchParams] = useSearchParams();

  const [ticketId, setTicketId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Context pill for reported orders (keeps composer blank)
  const [orderContext, setOrderContext] = useState<OrderContext | null>(null);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isNearBottomRef = useRef(true);

  // Parse order params from URL on mount
  useEffect(() => {
    const orderShortId = searchParams.get('orderShortId');
    const orderId = searchParams.get('orderId');
    if (orderShortId && orderId) {
      setOrderContext({
        shortId: orderShortId,
        id: orderId,
        network: searchParams.get('network') || undefined,
        volume: searchParams.get('volume') || undefined,
        phone: searchParams.get('phone') || undefined,
        status: searchParams.get('status') || undefined,
      });
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = messagesContainerRef.current;
    if (!el) return;
    if (smooth) {
      try {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      } catch {
        el.scrollTop = el.scrollHeight;
      }
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const forceScrollToBottom = useCallback((smooth = false) => {
    scrollToBottom(smooth);
    const raf = requestAnimationFrame(() => {
      scrollToBottom(smooth);
      requestAnimationFrame(() => scrollToBottom(smooth));
    });
    const t1 = setTimeout(() => scrollToBottom(smooth), 60);
    const t2 = setTimeout(() => scrollToBottom(smooth), 180);
    const t3 = setTimeout(() => scrollToBottom(smooth), 350);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [scrollToBottom]);

  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceToBottom < 120;
  }, []);

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (isNearBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!loading && messages.length > 0 && isNearBottomRef.current) {
      forceScrollToBottom(false);
    }
  }, [loading, messages.length, forceScrollToBottom]);

  // Load chat and mark notifications read
  const initChat = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data: customer } = await supabase
        .from('customers')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!customer?.id) return;

      let { data: ticket } = await supabase
        .from('support_tickets')
        .select('id, customer_cleared_at')
        .eq('customer_id', customer.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!ticket) {
        const { data: newTicket, error: createErr } = await supabase
          .from('support_tickets')
          .insert({
            customer_id: customer.id,
            subject: 'Customer Support',
            category: 'general',
            priority: 'medium',
            message: 'Support conversation started',
          })
          .select('id, customer_cleared_at')
          .single();

        if (createErr) throw createErr;
        ticket = newTicket;
      }

      setTicketId(ticket.id);

      let query = supabase
        .from('support_messages')
        .select('*')
        .eq('ticket_id', ticket.id);

      if (ticket.customer_cleared_at) {
        query = query.gt('created_at', ticket.customer_cleared_at);
      }

      const { data: msgs, error: msgErr } = await query.order('created_at', { ascending: true });
      if (msgErr) throw msgErr;

      setMessages((msgs as Message[]) || []);
      isNearBottomRef.current = true;

      // Clear customer notification bell for support messages
      supabase
        .from('notifications')
        .update({ read: true } as any)
        .eq('user_id', user.id)
        .eq('type', 'support')
        .eq('read', false)
        .then(() => {})
        .catch(() => {});

      // Mark messages read on server
      supabase
        .rpc('mark_support_messages_read', {
          p_ticket_id: ticket.id,
          p_reader_role: 'customer',
        })
        .catch(() => {});
    } catch (err: any) {
      console.error('Error initializing support chat:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    initChat();
  }, [initChat]);

  // Realtime incoming admin replies
  useEffect(() => {
    if (!ticketId || !user?.id) return;

    const channel = supabase
      .channel(`customer-chat-live-${ticketId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'support_messages',
          filter: `ticket_id=eq.${ticketId}`,
        },
        (payload) => {
          const newMsg = payload.new as Message;

          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            const hasTemp = prev.some(
              (m) => m.id.startsWith('temp-') && m.message === newMsg.message
            );
            if (hasTemp) {
              return prev.map((m) =>
                m.id.startsWith('temp-') && m.message === newMsg.message ? newMsg : m
              );
            }
            return [...prev, newMsg];
          });

          if (newMsg.sender_role === 'admin') {
            supabase
              .rpc('mark_support_messages_read', {
                p_ticket_id: ticketId,
                p_reader_role: 'customer',
              })
              .catch(() => {});

            supabase
              .from('notifications')
              .update({ read: true } as any)
              .eq('user_id', user.id)
              .eq('type', 'support')
              .eq('read', false)
              .then(() => {})
              .catch(() => {});
          }

          if (isNearBottomRef.current) {
            forceScrollToBottom(true);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ticketId, user?.id, forceScrollToBottom]);

  // Send message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = replyText.trim();
    if ((!text && !attachment) || sending || !user?.id) return;

    if (!ticketId) {
      toast({
        title: 'Connecting to chat...',
        description: 'Please wait a moment while the conversation connects.',
      });
      await initChat();
      return;
    }

    // Embed order metadata if replying with an order context
    let finalMessage = text;
    if (orderContext) {
      const meta = [
        orderContext.shortId,
        orderContext.network || '',
        orderContext.volume || '',
        orderContext.phone || '',
        orderContext.status || '',
      ].join('|');
      finalMessage = `[ORDER_REF:${meta}]\n${text}`;
    }

    const tempId = 'temp-' + Date.now();
    const optimisticMsg: Message = {
      id: tempId,
      ticket_id: ticketId,
      sender_id: user.id,
      sender_role: 'customer',
      message: finalMessage || (attachment ? 'Attachment sent' : ''),
      attachment_url: null,
      read_at: null,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setReplyText('');
    setOrderContext(null);
    const sentAttachment = attachment;
    setAttachment(null);
    if (textareaRef.current) textareaRef.current.style.height = '42px';

    forceScrollToBottom(true);
    setSending(true);

    try {
      let attachmentUrl: string | null = null;
      if (sentAttachment) {
        const fileExt = sentAttachment.name.split('.').pop();
        const filePath = `support/${ticketId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('attachments')
          .upload(filePath, sentAttachment);
        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('attachments')
          .getPublicUrl(filePath);
        attachmentUrl = urlData.publicUrl;
      }

      const { data: insertedMsg, error: sendErr } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: ticketId,
          sender_id: user.id,
          sender_role: 'customer',
          message: finalMessage || (attachmentUrl ? 'Attachment sent' : ''),
          attachment_url: attachmentUrl,
        })
        .select()
        .single();

      if (sendErr) throw sendErr;

      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? (insertedMsg as Message) : m))
      );
    } catch (err: any) {
      console.error('Send message error:', err);
      toast({
        title: 'Error sending message',
        description: err.message || 'Please try again.',
        variant: 'destructive',
      });
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } finally {
      setSending(false);
    }
  };

  const handleClearHistory = async () => {
    if (!ticketId) return;
    setDeleting(true);
    try {
      const { error } = await supabase.rpc('customer_clear_chat_history', {
        p_ticket_id: ticketId,
      });
      if (error) throw error;

      setMessages([]);
      toast({
        title: 'Chat cleared',
        description: 'Your message history has been deleted from your view.',
      });
      setDeleteDialogOpen(false);
    } catch (err: any) {
      console.error('Error clearing history:', err);
      toast({
        title: 'Failed to clear chat',
        description: err.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setReplyText(e.target.value);
    e.target.style.height = '42px';
    const newHeight = Math.min(e.target.scrollHeight, 120);
    e.target.style.height = `${newHeight}px`;
  };

  const groupedMessages = useMemo(() => {
    const groups: { date: string; items: Message[] }[] = [];
    messages.forEach((msg) => {
      const dateKey = msg.created_at ? msg.created_at.split('T')[0] : 'unknown';
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.date === dateKey) {
        lastGroup.items.push(msg);
      } else {
        groups.push({ date: dateKey, items: [msg] });
      }
    });
    return groups;
  }, [messages]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background overflow-hidden select-none">
      {/* ── Fixed WhatsApp-Style Header ── */}
      <header className="h-14 shrink-0 bg-card border-b border-border/40 px-3 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full shrink-0 -ml-1 text-muted-foreground hover:text-foreground"
            onClick={() => navigate('/dashboard')}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="relative">
            <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
              <LifeBuoy className="w-4 h-4" />
            </div>
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-card" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-foreground truncate leading-tight">
              DATA360 Support
            </h1>
            <p className="text-[11px] text-emerald-500 font-medium">Online</p>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full text-muted-foreground">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive gap-2 cursor-pointer"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={messages.length === 0}
            >
              <Trash2 className="w-4 h-4" />
              Delete Message
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* ── Scrollable Messages Area ── */}
      <main
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4 overscroll-contain bg-muted/15"
      >
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground">
            <LifeBuoy className="w-10 h-10 mb-2 opacity-30 text-primary" />
            <p className="text-sm font-medium text-foreground">Welcome to DATA360 Support</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
              How can we help you today? Send a message to start chatting with an agent.
            </p>
          </div>
        ) : (
          groupedMessages.map((group) => (
            <div key={group.date} className="space-y-3">
              <div className="flex justify-center my-2">
                <span className="text-[11px] font-medium bg-muted/80 backdrop-blur-xs text-muted-foreground px-2.5 py-0.5 rounded-full border border-border/30">
                  {formatDateDivider(group.items[0]?.created_at)}
                </span>
              </div>

              {group.items.map((msg) => {
                const isCustomer = msg.sender_role === 'customer';

                let displayMessage = msg.message;
                let orderTag: string | null = null;
                if (displayMessage && displayMessage.startsWith('[ORDER_REF:')) {
                  const endIdx = displayMessage.indexOf(']');
                  if (endIdx !== -1) {
                    const metaParts = displayMessage.substring(11, endIdx).split('|');
                    orderTag = metaParts[0] || 'Order Issue';
                    displayMessage = displayMessage.substring(endIdx + 1).trim();
                  }
                }

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isCustomer ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`relative max-w-[82%] sm:max-w-[70%] rounded-2xl px-3.5 py-2 shadow-xs text-xs sm:text-[13px] leading-relaxed break-words ${
                        isCustomer
                          ? 'bg-primary text-primary-foreground rounded-br-xs'
                          : 'bg-card text-foreground border border-border/40 rounded-bl-xs'
                      }`}
                    >
                      {orderTag && (
                        <div
                          className={`mb-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wide ${
                            isCustomer
                              ? 'bg-black/15 text-white/95'
                              : 'bg-primary/10 text-primary'
                          }`}
                        >
                          <Package className="w-3 h-3" />
                          <span>Regarding Order: {orderTag}</span>
                        </div>
                      )}

                      {displayMessage && (
                        <p className="whitespace-pre-wrap">{displayMessage}</p>
                      )}

                      {msg.attachment_url && (
                        <div className="mt-2">
                          <AttachmentRenderer url={msg.attachment_url} />
                        </div>
                      )}

                      <div
                        className={`mt-1 flex items-center justify-end gap-1 text-[10px] select-none ${
                          isCustomer
                            ? 'text-primary-foreground/75'
                            : 'text-muted-foreground/75'
                        }`}
                      >
                        <span>
                          {msg.created_at
                            ? format(new Date(msg.created_at), 'h:mm a')
                            : ''}
                        </span>
                        {isCustomer && (
                          <span>
                            {msg.id.startsWith('temp-') ? (
                              <span className="opacity-50">⋯</span>
                            ) : msg.read_at ? (
                              <CheckCheck className="w-3.5 h-3.5 text-sky-300" />
                            ) : (
                              <Check className="w-3.5 h-3.5" />
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </main>

      {/* ── Dismissible Order Reference Pill ── */}
      {orderContext && (
        <div className="bg-primary/10 border-t border-primary/20 px-3 py-1.5 flex items-center justify-between text-xs text-primary animate-in fade-in">
          <div className="flex items-center gap-1.5 truncate">
            <Package className="w-3.5 h-3.5 shrink-0" />
            <span className="font-medium">
              Replying about Order {orderContext.shortId}
              {orderContext.network && orderContext.volume
                ? ` (${orderContext.network} • ${orderContext.volume})`
                : ''}
            </span>
          </div>
          <button
            onClick={() => setOrderContext(null)}
            className="p-1 hover:bg-primary/20 rounded-full transition-colors"
            title="Dismiss order context"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Fixed Composer Area ── */}
      <footer className="shrink-0 bg-card border-t border-border/40 p-2 sm:p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {attachment && (
          <div className="mb-2 px-2 py-1 bg-muted rounded-lg flex items-center justify-between text-xs">
            <span className="truncate max-w-[200px] text-muted-foreground font-mono">
              {attachment.name}
            </span>
            <button
              onClick={() => setAttachment(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <form onSubmit={handleSendMessage} className="flex items-end gap-1.5">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/*,.pdf,.doc,.docx"
            onChange={(e) => {
              if (e.target.files?.[0]) setAttachment(e.target.files[0]);
            }}
          />

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="w-5 h-5" />
          </Button>

          <Textarea
            ref={textareaRef}
            value={replyText}
            onChange={handleTextareaInput}
            onKeyDown={handleKeyDown}
            placeholder={
              orderContext
                ? `Describe your issue with ${orderContext.shortId}...`
                : 'Type a message...'
            }
            rows={1}
            className="min-h-[42px] max-h-[120px] resize-none py-2.5 px-3.5 rounded-2xl bg-muted/40 border-border/50 text-xs sm:text-[13px] focus-visible:ring-1 focus-visible:ring-primary leading-relaxed"
          />

          <Button
            type="submit"
            disabled={(!replyText.trim() && !attachment) || sending}
            size="icon"
            className="h-10 w-10 shrink-0 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs disabled:opacity-40"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </form>
      </footer>

      {/* ── Clear Chat Confirmation Dialog ── */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="max-w-[340px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-semibold">
              Delete Message History?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground">
              This will clear your messages from this screen. Your account and ticket records
              will remain intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2 justify-end">
            <AlertDialogCancel disabled={deleting} className="text-xs h-9 mt-0">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearHistory}
              disabled={deleting}
              className="text-xs h-9 bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
