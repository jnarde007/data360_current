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
import { useNavigate } from 'react-router-dom';

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

  const [ticketId, setTicketId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isNearBottomRef = useRef(true);

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

  // Load chat and mark notifications read (Fixed auth_user_id query)
  const initChat = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data: customer, error: custErr } = await supabase
        .from('customers')
        .select('id')
        .or(`auth_user_id.eq.${user.id},id.eq.${user.id}`)
        .maybeSingle();

      if (custErr) throw custErr;
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

  // LIVE REALTIME WEBSOCKET
  useEffect(() => {
    if (!ticketId) return;

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
              .eq('user_id', user?.id)
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

    const tempId = 'temp-' + Date.now();
    const optimisticMsg: Message = {
      id: tempId,
      ticket_id: ticketId,
      sender_id: user.id,
      sender_role: 'customer',
      message: text || (attachment ? 'Attachment sent' : ''),
      attachment_url: null,
      read_at: null,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setReplyText('');
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
          message: text || (attachmentUrl ? 'Attachment sent' : ''),
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
      setDeleteDialogOpen(false);
      toast({
        title: 'Chat cleared',
        description: 'Your message history has been cleared.',
      });
    } catch (err: any) {
      console.error('Failed to clear chat:', err);
      toast({
        title: 'Error clearing chat',
        description: err.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setReplyText(e.target.value);
    const target = e.target;
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const groupedMessages = useMemo(() => {
    const groups: { dateLabel: string; items: Message[] }[] = [];
    messages.forEach((msg) => {
      const label = formatDateDivider(msg.created_at);
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.dateLabel === label) {
        lastGroup.items.push(msg);
      } else {
        groups.push({ dateLabel: label, items: [msg] });
      }
    });
    return groups;
  }, [messages]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#F4F7FB] text-slate-900 overflow-hidden font-sans select-none">
      {/* WhatsApp Header */}
      <header className="h-14 shrink-0 bg-white border-b border-border/40 px-3 sm:px-4 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/dashboard')}
            className="h-9 w-9 text-slate-300 hover:text-white hover:bg-white/10 rounded-full shrink-0 -ml-1"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>

          <div className="relative shrink-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-primary font-bold text-xs sm:text-sm shadow-xs">
              <LifeBuoy className="w-5 h-5" />
            </div>
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-[#202c33]" />
          </div>

          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-slate-900 truncate flex items-center gap-2">
              <span className="font-bold !text-blue-600">DATA360 Support</span>
            </h1>
            <p className="text-[11px] text-emerald-400 font-medium leading-none">
              Online
            </p>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-slate-300 hover:text-white hover:bg-white/10 rounded-full"
            >
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44 bg-card border-border/40 text-slate-200">
            <DropdownMenuItem
              onClick={() => setDeleteDialogOpen(true)}
              className="text-rose-400 focus:text-rose-300 focus:bg-rose-500/10 cursor-pointer text-xs gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete Messages
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* Messages Scroll Area */}
      <main
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 space-y-3 bg-[#F4F7FB] overscroll-contain"
        style={{
          backgroundImage:
            'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.02) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      >
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
            <div className="w-14 h-14 rounded-2xl bg-white border border-border/40 p-2 flex items-center justify-center mb-3 shadow-xs">
              <img src="/favicon.png" alt="DATA360" className="w-full h-full object-contain" />
            </div>
            <p className="text-sm font-semibold text-slate-300">Welcome to <span className="font-bold !text-blue-600">DATA360 Support</span></p>
            <p className="text-xs text-slate-500 mt-1 max-w-xs">
              How can we help you today? Send a message to start chatting with an agent.
            </p>
          </div>
        ) : (
          groupedMessages.map((group) => (
            <div key={group.dateLabel} className="space-y-2">
              {group.dateLabel && (
                <div className="flex justify-center my-3">
                  <span className="px-2.5 py-0.5 rounded-md bg-[#182229] border border-border/40 text-[11px] font-medium text-slate-400 shadow-xs">
                    {group.dateLabel}
                  </span>
                </div>
              )}

              {group.items.map((msg) => {
                const isCustomer = msg.sender_role === 'customer';
                const orderMatch = msg.message.match(/^\[ORDER_REF:(.*?)\]\n?([\s\S]*)$/);
                const orderMeta = orderMatch ? orderMatch[1].split('|') : null;
                const displayText = orderMatch ? orderMatch[2] : msg.message;

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isCustomer ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`relative max-w-[82%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 shadow-xs text-xs sm:text-[13px] leading-relaxed break-words ${isCustomer ? 'bg-[#4E89E8] text-white rounded-br-xs' : 'bg-[#E8F0FA] text-slate-900 rounded-bl-xs'}`}
                    >
                      {/* Order Context Tag on Bubble */}
                      {orderMeta && (
                        <div className="mb-1.5 p-2 rounded-xl bg-black/25 border border-white/10 text-[11px] space-y-0.5">
                          <div className="flex items-center gap-1.5 font-semibold text-emerald-300">
                            <Package className="w-3.5 h-3.5 !text-blue-600 shrink-0" />
                            <span>Order: {orderMeta[0]}</span>
                            {orderMeta[1] && <span>• {orderMeta[1]} {orderMeta[2]}</span>}
                          </div>
                          {orderMeta[3] && (
                            <div className="text-[10px] text-slate-300">
                              Recipient: {orderMeta[3]}
                            </div>
                          )}
                        </div>
                      )}

                      {msg.attachment_url && (
                        <div className="mb-2">
                          <AttachmentRenderer url={msg.attachment_url} />
                        </div>
                      )}

                      {displayText && (
                        <p className="whitespace-pre-wrap break-words">{displayText}</p>
                      )}

                      <div className="flex items-center justify-end gap-1 mt-1 text-[10px] text-slate-400/80">
                        <span>
                          {format(new Date(msg.created_at), 'h:mm a')}
                        </span>
                        {isCustomer && (
                          <span>
                            {msg.id.startsWith('temp-') ? (
                              <span className="opacity-50">⋯</span>
                            ) : msg.read_at ? (
                              <CheckCheck className="w-3.5 h-3.5 text-sky-400" />
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

      {/* WhatsApp Composer */}
      <footer className="shrink-0 bg-white border-t border-border/40 p-2 sm:p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {attachment && (
          <div className="mb-2 px-2.5 py-1.5 bg-white rounded-lg flex items-center justify-between text-xs border border-border/40">
            <span className="truncate max-w-[200px] text-slate-300 font-mono">
              {attachment.name}
            </span>
            <button
              onClick={() => setAttachment(null)}
              className="text-slate-600 hover:text-slate-900"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <form onSubmit={handleSendMessage} className="flex items-end gap-1.5 sm:gap-2">
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
            className="h-10 w-10 shrink-0 rounded-full text-slate-600 hover:text-slate-900 hover:bg-white/10"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="w-5 h-5" />
          </Button>

          <Textarea
            ref={textareaRef}
            value={replyText}
            onChange={handleTextareaInput}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            className="min-h-[42px] max-h-[120px] resize-none py-2.5 px-3.5 rounded-2xl bg-slate-100 border-none text-slate-900 placeholder:text-slate-500 text-xs sm:text-[13px] focus-visible:ring-1 focus-visible:ring-emerald-500 leading-relaxed"
          />

          <Button
            type="submit"
            disabled={(!replyText.trim() && !attachment) || sending}
            size="icon"
            className="h-10 w-10 shrink-0 rounded-full bg-[#4E89E8] hover:bg-[#3B74CC] text-white shadow-xs disabled:opacity-40"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </form>
      </footer>

      {/* Clear Chat Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="max-w-[340px] rounded-2xl bg-card border-border/40 text-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-semibold">
              Delete Message History?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-slate-400">
              This will clear your messages from your view. The admin support team will
              still have records of past support inquiries.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2 justify-end">
            <AlertDialogCancel
              disabled={deleting}
              className="text-xs h-9 mt-0 bg-transparent border-slate-600 text-slate-300 hover:bg-white/10"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearHistory}
              disabled={deleting}
              className="text-xs h-9 bg-rose-600 hover:bg-rose-700 text-white"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
