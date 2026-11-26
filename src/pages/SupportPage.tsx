import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AttachmentRenderer } from '@/components/support/AttachmentRenderer';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2, ArrowLeft, Send, LifeBuoy, Paperclip, MoreVertical, Trash2, Check, CheckCheck, X, Package
} from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';

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
  orderId: string;
  shortId: string;
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

  const [loading, setLoading] = useState(true);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);

  // Referenced order banner state
  const [orderContext, setOrderContext] = useState<OrderContext | null>(null);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isNearBottomRef = useRef(true);

  // Read order context from search parameters
  useEffect(() => {
    const orderShortId = searchParams.get('orderShortId') || searchParams.get('order');
    if (orderShortId) {
      setOrderContext({
        orderId: searchParams.get('orderId') || '',
        shortId: orderShortId,
        network: searchParams.get('network') || '',
        volume: searchParams.get('volume') || '',
        phone: searchParams.get('phone') || '',
        status: searchParams.get('status') || '',
      });
      setSearchParams({}, { replace: true });
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 150);
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
    const raf1 = requestAnimationFrame(() => {
      scrollToBottom(smooth);
      requestAnimationFrame(() => scrollToBottom(smooth));
    });
    const t1 = setTimeout(() => scrollToBottom(smooth), 60);
    const t2 = setTimeout(() => scrollToBottom(smooth), 180);
    const t3 = setTimeout(() => scrollToBottom(smooth), 350);
    return () => {
      cancelAnimationFrame(raf1);
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
      if (isNearBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!loading && messages.length > 0 && isNearBottomRef.current) {
      forceScrollToBottom(false);
    }
  }, [loading, messages.length, forceScrollToBottom]);

  const initChat = useCallback(async () => {
    if (!user) return;
    try {
      const customerId = user.customer_id || user.id;

      const { data: tickets, error } = await supabase
        .from('support_tickets')
        .select('id, short_id, customer_cleared_at, created_at, updated_at')
        .eq('customer_id', customerId)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (error) throw error;

      let tid: string;
      let customerClearedAt: string | null = null;

      if (!tickets || tickets.length === 0) {
        const { data: newTicket, error: createErr } = await supabase
          .from('support_tickets')
          .insert({
            customer_id: customerId,
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
        customerClearedAt = (tickets[0] as any).customer_cleared_at || null;
      }

      setTicketId(tid);

      let query = supabase
        .from('support_messages')
        .select('*')
        .eq('ticket_id', tid);

      if (customerClearedAt) {
        query = query.gt('created_at', customerClearedAt);
      }

      const { data: msgs, error: msgErr } = await query.order('created_at', { ascending: true });

      if (!msgErr && msgs) {
        setMessages(msgs as Message[]);
        isNearBottomRef.current = true;
      }

      // Mark read in messages AND notification center
      supabase.rpc('mark_support_messages_read', {
        p_ticket_id: tid,
        p_reader_role: 'customer'
      }).catch(() => {});

      supabase
        .from('notifications')
        .update({ read: true } as any)
        .eq('target_type', 'customer')
        .eq('type', 'support')
        .eq('read', false)
        .then(() => {})
        .catch(() => {});

    } catch (err: any) {
      console.error('Error initializing chat:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    initChat();
  }, [initChat]);

  // Realtime subscription
  useEffect(() => {
    if (!ticketId) return;

    const channel = supabase
      .channel(`customer-chat-${ticketId}`)
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

          if (newMsg.sender_role !== 'customer') {
            supabase.rpc('mark_support_messages_read', {
              p_ticket_id: ticketId,
              p_reader_role: 'customer'
            }).catch(() => {});

            supabase
              .from('notifications')
              .update({ read: true } as any)
              .eq('target_type', 'customer')
              .eq('type', 'support')
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
  }, [ticketId, forceScrollToBottom]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = replyText.trim();
    if ((!text && !attachment) || sending) return;

    if (!ticketId || !user?.id) {
      toast({
        title: 'Connecting to chat...',
        description: 'Please wait a moment while your chat connects.',
      });
      initChat();
      return;
    }

    // Attach order reference header if reporting an order
    let finalPayloadMessage = text;
    if (orderContext) {
      const orderMeta = [
        `[ORDER_REF:${orderContext.shortId}|${orderContext.network || ''}|${orderContext.volume || ''}|${orderContext.phone || ''}|${orderContext.status || ''}]`,
        text
      ].filter(Boolean).join('\n');
      finalPayloadMessage = orderMeta;
    }

    const tempId = 'temp-' + Date.now();
    const optimisticMsg: Message = {
      id: tempId,
      ticket_id: ticketId,
      sender_id: user.customer_id || user.id,
      sender_role: 'customer',
      message: finalPayloadMessage || (attachment ? 'Sent an attachment' : ''),
      attachment_url: null,
      created_at: new Date().toISOString(),
      read_at: null,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setReplyText('');
    setOrderContext(null); // Clear context once sent
    const sentAttachment = attachment;
    setAttachment(null);
    if (textareaRef.current) textareaRef.current.style.height = '42px';

    isNearBottomRef.current = true;
    forceScrollToBottom(true);
    setSending(true);

    try {
      let uploadedUrl: string | null = null;
      if (sentAttachment) {
        const ext = sentAttachment.name.split('.').pop() || 'bin';
        const filePath = `${user.id}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('support-attachments')
          .upload(filePath, sentAttachment);

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
          sender_id: user.customer_id || user.id,
          sender_role: 'customer',
          message: finalPayloadMessage || (uploadedUrl ? 'Sent an attachment' : ''),
          attachment_url: uploadedUrl,
        } as any)
        .select()
        .single();

      if (insertErr) throw insertErr;

      if (newMsg) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? (newMsg as Message) : m))
        );
      }
    } catch (err: any) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      toast({
        title: 'Failed to send message',
        description: err.message || 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const handleDeleteConversation = async () => {
    if (!ticketId) return;
    setDeleting(true);
    try {
      const { error } = await supabase.rpc('customer_clear_chat_history', {
        p_ticket_id: ticketId,
      });

      if (error) throw error;

      setMessages([]);
      setDeleteDialogOpen(false);
      toast({
        title: 'Chat cleared',
        description: 'Your conversation history has been cleared.',
      });
    } catch (err: any) {
      toast({
        title: 'Error clearing chat',
        description: err.message || 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setReplyText(e.target.value);
    const target = e.target;
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
  };

  const groupedMessages = useMemo(() => {
    return messages.reduce((acc, msg) => {
      const dateKey = msg.created_at ? format(new Date(msg.created_at), 'yyyy-MM-dd') : 'unknown';
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push(msg);
      return acc;
    }, {} as Record<string, Message[]>);
  }, [messages]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground h-[100dvh] w-full overflow-hidden select-none">
      {/* Header */}
      <header className="h-14 md:h-16 px-3 md:px-4 bg-card/95 backdrop-blur-md border-b border-border/50 flex items-center justify-between shrink-0 shadow-xs">
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
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">Online {'•'} Instant Help</p>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onClick={() => setDeleteDialogOpen(true)}
              disabled={messages.length === 0}
              className="text-destructive focus:text-destructive flex items-center gap-2 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete Message</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* Messages */}
      <main
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-4 md:px-6 space-y-4 bg-muted/20"
      >
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
              <div className="flex justify-center my-2 sticky top-2 z-10">
                <span className="px-3 py-1 rounded-full text-[11px] font-medium bg-card/90 text-muted-foreground shadow-xs border border-border/40">
                  {formatDateDivider(msgs[0]?.created_at || dateKey)}
                </span>
              </div>

              {msgs.map((m) => {
                const isCustomer = m.sender_role === 'customer';

                // Parse out Order Reference tag if present
                const orderRefMatch = m.message.match(/^\[ORDER_REF:([^|\]]+)(?:\|([^|\]]*))?(?:\|([^|\]]*))?(?:\|([^|\]]*))?(?:\|([^|\]]*))?\]\n?([\s\S]*)$/);
                const orderShortId = orderRefMatch ? orderRefMatch[1] : null;
                const cleanText = orderRefMatch ? orderRefMatch[6] : m.message;

                return (
                  <div
                    key={m.id}
                    className={`flex w-full ${isCustomer ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`relative max-w-[85%] sm:max-w-md rounded-2xl px-3.5 py-2.5 shadow-xs text-sm break-words ${
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

                      {/* Customer-side Order Tag */}
                      {orderShortId && (
                        <div className="mb-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/15 text-[11px] font-medium">
                          <Package className="w-3.5 h-3.5" />
                          <span>Regarding Order: <strong>{orderShortId}</strong></span>
                        </div>
                      )}

                      {m.attachment_url && (
                        <div className="mb-2 rounded-lg overflow-hidden">
                          <AttachmentRenderer url={m.attachment_url} />
                        </div>
                      )}

                      {cleanText && (
                        <p className="whitespace-pre-wrap leading-relaxed select-text">{cleanText}</p>
                      )}

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
      </main>

      {/* Composer */}
      <footer className="p-2 md:p-3 bg-card border-t border-border/50 shrink-0 shadow-lg pb-[max(0.6rem,env(safe-area-inset-bottom))]">
        {/* Order Reference Pill (appears when customer taps Report) */}
        {orderContext && (
          <div className="flex items-center justify-between bg-primary/10 border border-primary/20 px-3 py-2 rounded-xl mb-2 text-xs max-w-4xl mx-auto text-primary">
            <span className="flex items-center gap-2 truncate font-medium">
              <Package className="w-4 h-4 shrink-0" />
              <span>Replying about Order <strong>{orderContext.shortId}</strong> {orderContext.network && `(${orderContext.network} ${orderContext.volume || ''})`}</span>
            </span>
            <button
              type="button"
              onClick={() => setOrderContext(null)}
              className="text-primary/70 hover:text-primary p-0.5 rounded-md hover:bg-primary/10"
              title="Remove order reference"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

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
              <X className="w-3.5 h-3.5" />
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
            className="h-10 w-10 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted shrink-0"
            title="Attach File"
          >
            <Paperclip className="w-4 h-4" />
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
            placeholder={orderContext ? `Describe your issue with order ${orderContext.shortId}...` : "Type a message..."}
            maxLength={2000}
            className="min-h-[42px] max-h-[120px] resize-none text-sm rounded-2xl bg-muted/50 border-border/50 focus-visible:ring-1 focus-visible:ring-primary py-2 px-3.5 leading-relaxed"
          />

          <Button
            type="submit"
            disabled={(!replyText.trim() && !attachment) || sending}
            className="h-10 w-10 rounded-full p-0 flex items-center justify-center bg-primary text-primary-foreground shadow-xs shrink-0"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 ml-0.5" />}
          </Button>
        </form>
      </footer>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Message?</AlertDialogTitle>
            <AlertDialogDescription>
              This will clear the conversation messages from your view. Support records will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConversation}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Deleting...' : 'Delete Message'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
