import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { CustomerLayout } from '@/components/CustomerLayout';
import { supabase } from '@/integrations/supabase/client';
import { useSearchParams } from 'react-router-dom';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CreateTicketDialog } from '@/components/support/CreateTicketDialog';
import { AttachmentRenderer } from '@/components/support/AttachmentRenderer';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2, Plus, ArrowLeft, Send, Paperclip,
  X, Search, MessageSquare, Receipt
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';

interface Ticket {
  id: string;
  short_id: string;
  subject: string;
  category: string;
  message: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
  related_order_id: string | null;
  related_wallet_transaction_id: string | null;
  latest_message?: string;
  latest_sender_role?: string;
  latest_message_time?: string;
  unread_count?: number;
}

interface Message {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_role: string;
  message: string;
  attachment_url: string | null;
  created_at: string;
  read_at?: string | null;
}

export default function SupportPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [relatedOrderShortId, setRelatedOrderShortId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deepLinkedRef = useRef(false);

  // Load conversations with latest preview and unread counters
  const loadTickets = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data: ticketsData, error } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('customer_id', user.id)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      const list = (ticketsData || []) as Ticket[];

      if (list.length > 0) {
        const ticketIds = list.map(t => t.id);

        const { data: allMsgs } = await supabase
          .from('support_messages')
          .select('ticket_id, sender_role, message, created_at, read_at')
          .in('ticket_id', ticketIds)
          .order('created_at', { ascending: true });

        const unreadMap: Record<string, number> = {};
        const latestMsgMap: Record<string, { text: string; role: string; time: string }> = {};

        (allMsgs || []).forEach((m: any) => {
          latestMsgMap[m.ticket_id] = {
            text: m.message === '[Attachment]' ? '📎 Attachment' : m.message,
            role: m.sender_role,
            time: m.created_at,
          };

          // Count only unread incoming messages from support
          if (m.sender_role !== 'customer' && !m.read_at) {
            unreadMap[m.ticket_id] = (unreadMap[m.ticket_id] || 0) + 1;
          }
        });

        list.forEach(t => {
          const latest = latestMsgMap[t.id];
          if (latest) {
            t.latest_message = latest.text;
            t.latest_sender_role = latest.role;
            t.latest_message_time = latest.time;
          } else {
            t.latest_message = t.message;
            t.latest_sender_role = 'customer';
            t.latest_message_time = t.created_at;
          }
          t.unread_count = unreadMap[t.id] || 0;
        });
      }

      setTickets(list);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { loadTickets(); }, [loadTickets]);
  useRealtimeRefresh(['support_tickets' as any, 'support_messages' as any], loadTickets, 'customer-chat-sync');

  // Deep-link: auto-open from query params
  useEffect(() => {
    if (deepLinkedRef.current || loading) return;
    if (searchParams.get('new') === 'true') {
      deepLinkedRef.current = true;
      setCreateOpen(true);
      setSearchParams({}, { replace: true });
      return;
    }
    const ticketParam = searchParams.get('ticket');
    if (!ticketParam || tickets.length === 0) return;
    const match = tickets.find(t => t.id === ticketParam || t.short_id === ticketParam);
    if (match) {
      deepLinkedRef.current = true;
      openTicket(match);
      setSearchParams({}, { replace: true });
    }
  }, [tickets, loading, searchParams]);

  const loadMessages = useCallback(async (ticketId: string) => {
    setMessagesLoading(true);
    try {
      const { data, error } = await supabase
        .from('support_messages')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setMessages((data || []) as Message[]);

      // Mark support messages as read
      await supabase
        .from('support_messages')
        .update({ read_at: new Date().toISOString() } as any)
        .eq('ticket_id', ticketId)
        .neq('sender_role', 'customer')
        .is('read_at', null);

      // Instantly clear unread count badge in UI
      setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, unread_count: 0 } : t));
    } catch {
      // silent
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  const openTicket = async (ticket: Ticket) => {
    setSelectedTicket(ticket);
    loadMessages(ticket.id);
    if (ticket.related_order_id) {
      const { data } = await supabase.from('orders').select('short_id').eq('id', ticket.related_order_id).single();
      setRelatedOrderShortId(data?.short_id || null);
    } else {
      setRelatedOrderShortId(null);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Real-time messages for open chat
  useEffect(() => {
    if (!selectedTicket) return;
    const channel = supabase
      .channel(`cust-live-msgs-${selectedTicket.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'support_messages',
        filter: `ticket_id=eq.${selectedTicket.id}`,
      }, (payload) => {
        const msg = payload.new as Message;
        setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
        if (msg.sender_role !== 'customer') {
          supabase
            .from('support_messages')
            .update({ read_at: new Date().toISOString() } as any)
            .eq('id', msg.id)
            .then(() => {});
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedTicket?.id]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Maximum file size is 5MB.', variant: 'destructive' });
      return;
    }
    setAttachment(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const sendReply = async () => {
    if ((!replyText.trim() && !attachment) || !selectedTicket || !user?.id) return;
    setSending(true);
    try {
      let attachmentUrl: string | null = null;
      if (attachment) {
        const ext = attachment.name.split('.').pop()?.toLowerCase() || 'bin';
        const path = `${user.id}/${selectedTicket.id}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from('support-attachments').upload(path, attachment);
        if (uploadErr) throw uploadErr;
        const { data: urlData } = supabase.storage.from('support-attachments').getPublicUrl(path);
        attachmentUrl = urlData.publicUrl;
      }

      const { error } = await supabase.from('support_messages').insert({
        ticket_id: selectedTicket.id,
        sender_id: user.id,
        sender_role: 'customer',
        message: replyText.trim() || (attachmentUrl ? '[Attachment]' : ''),
        attachment_url: attachmentUrl,
      } as any);

      if (error) throw error;
      setReplyText('');
      setAttachment(null);
    } catch {
      toast({ title: 'Failed to send', description: 'Could not send message. Please try again.', variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const visibleTickets = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tickets;
    return tickets.filter(t => t.subject?.toLowerCase().includes(q) || t.latest_message?.toLowerCase().includes(q) || t.short_id?.toLowerCase().includes(q));
  }, [tickets, search]);

  return (
    <CustomerLayout>
      {/* Outer Studio Container with soft periwinkle atmosphere */}
      <div className="max-w-7xl mx-auto pb-8 pt-2">
        {/* 2-Column Floating Cards Layout matching image-199 */}
        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 items-start">
          
          {/* ══════════════════════════════════════════════════════
              LEFT CARD: Conversation List
             ══════════════════════════════════════════════════════ */}
          <div className={`${selectedTicket ? 'hidden lg:block' : 'block'} bg-white dark:bg-card rounded-[28px] p-5 shadow-sm border border-slate-200/70 dark:border-border/60 lg:sticky lg:top-20`}>
            {/* Header: Title + Circular New Chat Button */}
            <div className="flex items-center justify-between gap-3 mb-5 px-1">
              <h1 className="text-2xl font-bold font-display tracking-tight text-[#1E293B] dark:text-foreground">
                Messages
              </h1>
              <Button
                onClick={() => setCreateOpen(true)}
                size="icon"
                className="h-10 w-10 rounded-full bg-[#1E3A8A] hover:bg-[#1e40af] text-white shadow-md hover:scale-105 transition-transform"
                title="Start New Chat"
              >
                <Plus className="w-5 h-5" />
              </Button>
            </div>

            {/* Search Bar */}
            <div className="relative mb-4">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <Input
                placeholder="Search conversations..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-10 h-11 text-xs rounded-2xl bg-slate-50 dark:bg-muted/40 border-slate-200/60 dark:border-border/50 text-foreground placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-blue-500"
              />
            </div>

            {/* Conversation List */}
            {loading ? (
              <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
            ) : visibleTickets.length === 0 ? (
              <div className="text-center py-12 rounded-2xl border border-dashed border-slate-200 dark:border-border/60 p-6 bg-slate-50/50 dark:bg-card/40">
                <MessageSquare className="w-10 h-10 mx-auto text-slate-300 dark:text-muted-foreground/30 mb-2" />
                <p className="text-sm font-semibold text-foreground">No conversations yet</p>
                <p className="text-xs text-muted-foreground mt-1">Need help with an order or account? Start a chat.</p>
                <Button onClick={() => setCreateOpen(true)} size="sm" className="mt-4 gap-2 text-xs rounded-xl bg-[#1E3A8A] text-white">
                  <Plus className="w-3.5 h-3.5" /> Start Chat
                </Button>
              </div>
            ) : (
              <div className="space-y-1 lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto lg:pr-1">
                {visibleTickets.map(t => {
                  const active = selectedTicket?.id === t.id;
                  const initial = t.subject ? t.subject.slice(0, 1).toUpperCase() : 'S';
                  const unread = (t.unread_count || 0) > 0;
                  const isYou = t.latest_sender_role === 'customer';

                  return (
                    <button
                      key={t.id}
                      onClick={() => openTicket(t)}
                      className={`w-full text-left rounded-2xl p-3.5 transition-all flex items-center gap-3.5 ${
                        active
                          ? 'bg-slate-100 dark:bg-muted shadow-xs'
                          : 'hover:bg-slate-50 dark:hover:bg-muted/40'
                      }`}
                    >
                      {/* Avatar with Online Green Dot */}
                      <div className="relative shrink-0">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-[#3b82f6] to-[#60a5fa] text-white flex items-center justify-center font-bold text-sm shadow-sm">
                          {initial}
                        </div>
                        <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-card" />
                      </div>

                      {/* Info & Dynamic Latest Message */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <p className={`text-xs truncate ${unread ? 'font-bold text-[#0f172a] dark:text-foreground' : 'font-semibold text-slate-800 dark:text-foreground/90'}`}>
                            {t.subject || 'Support Team'}
                          </p>
                          <span className={`text-[10px] shrink-0 ${unread ? 'text-red-500 font-bold' : 'text-slate-400'}`}>
                            {t.latest_message_time ? formatDistanceToNow(new Date(t.latest_message_time), { addSuffix: true }) : ''}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-[11px] truncate leading-tight ${unread ? 'font-medium text-slate-900 dark:text-foreground' : 'text-slate-500 dark:text-muted-foreground'}`}>
                            {isYou ? <span className="opacity-60">You: </span> : null}
                            {t.latest_message || t.message}
                          </p>

                          {/* Coral Red Unread Pill matching image-199 */}
                          {unread && (
                            <span className="min-w-[1.25rem] h-5 px-1.5 rounded-full bg-[#EA384D] text-white text-[10px] font-bold flex items-center justify-center shrink-0 shadow-xs">
                              {t.unread_count}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ══════════════════════════════════════════════════════
              RIGHT CARD: Chat Room
             ══════════════════════════════════════════════════════ */}
          <div className={selectedTicket ? 'block' : 'hidden lg:block'}>
            {selectedTicket ? (
              <div className="bg-white dark:bg-card rounded-[28px] shadow-sm border border-slate-200/70 dark:border-border/60 overflow-hidden flex flex-col h-[82vh] min-h-[560px]">
                
                {/* Curved Soft Periwinkle Header Bar matching image-199 */}
                <div className="px-5 py-4 bg-[#B8C5E6] dark:bg-slate-800 text-[#1E293B] dark:text-foreground flex items-center justify-between gap-3 shrink-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => { setSelectedTicket(null); setMessages([]); }}
                      className="h-8 w-8 rounded-full hover:bg-black/10 lg:hidden text-inherit"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </Button>
                    <div className="relative shrink-0">
                      <div className="w-10 h-10 rounded-full bg-white/80 dark:bg-white/10 text-blue-900 dark:text-blue-200 flex items-center justify-center font-bold text-xs shadow-xs">
                        S
                      </div>
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#1E293B] dark:text-foreground truncate">{selectedTicket.subject}</p>
                      <p className="text-[11px] text-[#475569] dark:text-slate-300 font-medium">Customer Support · Active now</p>
                    </div>
                  </div>

                  {relatedOrderShortId && (
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/70 dark:bg-slate-700/70 text-[11px] font-mono text-slate-800 dark:text-slate-200 shadow-xs shrink-0">
                      <Receipt className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>#{relatedOrderShortId}</span>
                    </div>
                  )}
                </div>

                {/* Messages Body (Clean White Surface with Pastel Bubbles) */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-white dark:bg-card">
                  {/* First Message from Creation (Outgoing: Warm Off-White Bubble) */}
                  <div className="flex flex-col items-end gap-1">
                    <div className="max-w-[82%] sm:max-w-[68%] rounded-2xl rounded-br-xs px-4 py-3 bg-[#F8FAFC] dark:bg-slate-800/80 text-slate-800 dark:text-slate-100 border border-slate-200/70 dark:border-slate-700 shadow-xs">
                      <p className="text-xs whitespace-pre-wrap leading-relaxed">{selectedTicket.message}</p>
                    </div>
                    <span className="text-[10px] text-slate-400 pr-1">
                      {format(new Date(selectedTicket.created_at), 'h:mm a')}
                    </span>
                  </div>

                  {/* Thread Replies */}
                  {messagesLoading ? (
                    <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-blue-600" /></div>
                  ) : (
                    messages.map(m => {
                      const isCustomer = m.sender_role === 'customer';

                      // Customer message (Outgoing on the Right: Warm Off-White)
                      if (isCustomer) {
                        return (
                          <div key={m.id} className="flex flex-col items-end gap-1">
                            <div className="max-w-[82%] sm:max-w-[68%] rounded-2xl rounded-br-xs px-4 py-3 bg-[#F8FAFC] dark:bg-slate-800/80 text-slate-800 dark:text-slate-100 border border-slate-200/70 dark:border-slate-700 shadow-xs">
                              {m.attachment_url && (
                                <div className="mb-2 p-1.5 rounded-xl bg-slate-100 dark:bg-slate-700">
                                  <AttachmentRenderer url={m.attachment_url} />
                                </div>
                              )}
                              {m.message && m.message !== '[Attachment]' && (
                                <p className="text-xs whitespace-pre-wrap leading-relaxed">{m.message}</p>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-400 pr-1">
                              {format(new Date(m.created_at), 'h:mm a')}
                            </span>
                          </div>
                        );
                      }

                      // Support reply (Incoming on the Left: Pastel Periwinkle-Blue Bubble matching image-199)
                      return (
                        <div key={m.id} className="flex items-start gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-[#B8C5E6] text-blue-900 flex items-center justify-center font-bold text-[10px] shrink-0 mt-1">
                            S
                          </div>
                          <div className="max-w-[82%] sm:max-w-[68%] space-y-1">
                            <span className="text-[10px] text-slate-400 pl-1 font-medium">Support</span>
                            <div className="rounded-2xl rounded-tl-xs px-4 py-3 bg-[#EBF2FE] dark:bg-slate-800 text-[#1E293B] dark:text-slate-100 border border-blue-100 dark:border-slate-700/60 shadow-xs">
                              {m.attachment_url && (
                                <div className="mb-2">
                                  <AttachmentRenderer url={m.attachment_url} />
                                </div>
                              )}
                              {m.message && m.message !== '[Attachment]' && (
                                <p className="text-xs whitespace-pre-wrap leading-relaxed">{m.message}</p>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-400 pl-1 block">
                              {format(new Date(m.created_at), 'h:mm a')}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Minimalist Floating Composer matching image-199 */}
                <div className="p-4 bg-white dark:bg-card border-t border-slate-100 dark:border-border/60 shrink-0">
                  {attachment && (
                    <div className="flex items-center justify-between mb-2 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-muted text-xs">
                      <span className="truncate max-w-[260px] text-muted-foreground">{attachment.name}</span>
                      <button type="button" onClick={() => setAttachment(null)} className="text-destructive">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                  <form
                    onSubmit={(e) => { e.preventDefault(); sendReply(); }}
                    className="flex items-center gap-2 bg-slate-50 dark:bg-muted/40 rounded-full px-3 py-1.5 border border-slate-200/60 dark:border-border/60"
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileSelect}
                      accept=".png,.jpg,.jpeg,.webp,.pdf"
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => fileInputRef.current?.click()}
                      className="h-8 w-8 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-foreground shrink-0"
                    >
                      <Paperclip className="w-4 h-4" />
                    </Button>
                    <Input
                      placeholder="Type a message..."
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      className="h-9 text-xs bg-transparent border-none shadow-none focus-visible:ring-0 px-2"
                    />
                    <Button
                      type="submit"
                      disabled={sending || (!replyText.trim() && !attachment)}
                      size="icon"
                      className="h-8 w-8 rounded-full bg-[#3B82F6] hover:bg-blue-600 text-white shrink-0 shadow-sm transition-transform hover:scale-105"
                    >
                      {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    </Button>
                  </form>
                </div>
              </div>
            ) : (
              <div className="bg-white dark:bg-card rounded-[28px] border border-slate-200/70 dark:border-border/60 p-12 text-center flex flex-col items-center justify-center min-h-[560px] shadow-sm">
                <div className="w-16 h-16 rounded-full bg-[#EBF2FE] dark:bg-slate-800 text-[#3B82F6] flex items-center justify-center mb-4">
                  <MessageSquare className="w-7 h-7" />
                </div>
                <h3 className="text-base font-bold text-foreground">Select a conversation</h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  Choose a chat on the left to read and reply, or start a new conversation.
                </p>
                <Button onClick={() => setCreateOpen(true)} size="sm" className="mt-5 gap-2 text-xs rounded-full px-5 bg-[#1E3A8A] hover:bg-[#1e40af] text-white shadow-sm">
                  <Plus className="w-3.5 h-3.5" /> Start New Chat
                </Button>
              </div>
            )}
          </div>
        </div>

        <CreateTicketDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={loadTickets} />
      </div>
    </CustomerLayout>
  );
}
