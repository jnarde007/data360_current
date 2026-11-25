import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { CustomerLayout } from '@/components/customer/CustomerLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { CreateTicketDialog } from '@/components/support/CreateTicketDialog';
import {
  Loader2, Plus, ArrowLeft, Send, LifeBuoy, Paperclip,
  FileText, Image as ImageIcon, X, Search, MessageSquare, Receipt
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { useSearchParams } from 'react-router-dom';

interface Ticket {
  id: string;
  short_id: string;
  customer_id: string;
  subject: string;
  category: string;
  message: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
  related_order_id: string | null;
  related_wallet_transaction_id: string | null;
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

  // Load user tickets and compute unread counts
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

      // Fetch unread messages for these tickets (messages from support not read by customer)
      if (list.length > 0) {
        const ticketIds = list.map(t => t.id);
        const { data: unreadData } = await supabase
          .from('support_messages')
          .select('ticket_id, read_at')
          .in('ticket_id', ticketIds)
          .neq('sender_role', 'customer')
          .is('read_at', null);

        const unreadMap: Record<string, number> = {};
        (unreadData || []).forEach((m: any) => {
          unreadMap[m.ticket_id] = (unreadMap[m.ticket_id] || 0) + 1;
        });

        list.forEach(t => {
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
  useRealtimeRefresh(['support_tickets' as any, 'support_messages' as any], loadTickets, 'customer-chat-live');

  // Deep-link from notification or query
  useEffect(() => {
    if (deepLinkedRef.current || loading || tickets.length === 0) return;
    const ticketParam = searchParams.get('ticket');
    if (!ticketParam) return;
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
      setMessages((data || []) as any);

      // Mark messages as read by customer
      try {
        await supabase.rpc('mark_support_messages_read' as any, {
          p_ticket_id: ticketId,
          p_reader_role: 'customer'
        });
      } catch {
        // Fallback update if RPC not present
        await supabase
          .from('support_messages')
          .update({ read_at: new Date().toISOString() } as any)
          .eq('ticket_id', ticketId)
          .neq('sender_role', 'customer')
          .is('read_at', null);
      }

      // Clear local unread badge
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

  // Real-time messages subscription
  useEffect(() => {
    if (!selectedTicket) return;
    const channel = supabase
      .channel(`customer-chat-${selectedTicket.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'support_messages',
        filter: `ticket_id=eq.${selectedTicket.id}`,
      }, (payload) => {
        const msg = payload.new as any;
        setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
        if (msg.sender_role !== 'customer') {
          // Auto-mark incoming message as read since conversation is open
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
    return tickets.filter(t => t.subject.toLowerCase().includes(q) || t.short_id.toLowerCase().includes(q));
  }, [tickets, search]);

  const AttachmentRenderer = ({ url }: { url: string }) => {
    const isImg = /\.(png|jpe?g|webp|gif)$/i.test(url);
    if (isImg) {
      return (
        <a href={url} target="_blank" rel="noopener noreferrer" className="block max-w-xs rounded-xl overflow-hidden shadow-sm hover:opacity-90 transition-opacity">
          <img src={url} alt="Attachment" className="max-h-48 rounded-xl object-cover" />
        </a>
      );
    }
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/60 text-xs text-primary font-medium hover:bg-muted transition-colors">
        <FileText className="w-4 h-4 shrink-0" /> Open Attachment
      </a>
    );
  };

  return (
    <CustomerLayout>
      <div className="space-y-4 max-w-5xl mx-auto pb-10">
        {/* Top Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold font-display tracking-tight text-foreground">Messages</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Chat directly with our support team</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-2 h-9 text-xs rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm">
            <Plus className="w-4 h-4" /> New Message
          </Button>
        </div>

        {/* Main 2-Column Chat View */}
        <div className="lg:grid lg:grid-cols-[minmax(300px,360px)_1fr] lg:gap-5 lg:items-start">
          {/* Left Column: WhatsApp-style Conversation List */}
          <div className={`${selectedTicket ? 'hidden lg:block' : 'block'} space-y-2 lg:sticky lg:top-24`}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search conversations..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 h-10 text-xs rounded-xl bg-card"
              />
            </div>

            {loading ? (
              <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : visibleTickets.length === 0 ? (
              <div className="text-center py-12 rounded-2xl border border-dashed border-border/70 p-6 bg-card/40">
                <MessageSquare className="w-10 h-10 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-sm font-semibold text-foreground">No conversations yet</p>
                <p className="text-xs text-muted-foreground mt-1">Need help with an order or payment? Send us a message.</p>
                <Button onClick={() => setCreateOpen(true)} size="sm" className="mt-4 gap-2 text-xs rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white">
                  <Plus className="w-3.5 h-3.5" /> Start Chat
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5 lg:max-h-[calc(100vh-16rem)] lg:overflow-y-auto lg:pr-1">
                {visibleTickets.map(t => {
                  const active = selectedTicket?.id === t.id;
                  const unread = (t.unread_count || 0) > 0;
                  return (
                    <button
                      key={t.id}
                      onClick={() => openTicket(t)}
                      className={`w-full text-left rounded-2xl border p-3.5 transition-all flex items-center gap-3 ${
                        active
                          ? 'border-emerald-500/40 bg-emerald-500/5 shadow-xs'
                          : 'border-border/50 bg-card hover:bg-muted/40'
                      }`}
                    >
                      {/* Avatar with unread indicator */}
                      <div className="relative shrink-0">
                        <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold text-xs">
                          {t.subject ? t.subject.slice(0, 1).toUpperCase() : 'S'}
                        </div>
                        {unread && (
                          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
                            {t.unread_count}
                          </span>
                        )}
                      </div>

                      {/* Content preview */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <p className={`text-xs truncate ${unread ? 'font-bold text-foreground' : 'font-semibold text-foreground/90'}`}>
                            {t.subject || 'Support Conversation'}
                          </p>
                          <span className="text-[10px] text-muted-foreground/60 shrink-0">
                            {formatDistanceToNow(new Date(t.updated_at), { addSuffix: true })}
                          </span>
                        </div>
                        <p className={`text-[11px] truncate ${unread ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                          {t.message}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Column: Live Conversation Thread */}
          <div className={selectedTicket ? 'block' : 'hidden lg:block'}>
            {selectedTicket ? (
              <div className="rounded-2xl border border-border/60 bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden flex flex-col h-[75vh] min-h-[500px]">
                {/* Chat Header Bar */}
                <div className="px-4 py-3 border-b border-border/50 bg-card/90 flex items-center justify-between gap-3 shrink-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => { setSelectedTicket(null); setMessages([]); }}
                      className="h-8 w-8 rounded-lg lg:hidden"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </Button>
                    <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold text-xs shrink-0">
                      S
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{selectedTicket.subject}</p>
                      <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">Customer Support</p>
                    </div>
                  </div>

                  {relatedOrderShortId && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted text-[11px] font-mono text-muted-foreground shrink-0">
                      <Receipt className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Order #{relatedOrderShortId}</span>
                    </div>
                  )}
                </div>

                {/* Messages Stream */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/10">
                  {/* First message from ticket creation */}
                  <div className="flex justify-end gap-2 items-end">
                    <div className="max-w-[85%] sm:max-w-[70%] space-y-1">
                      <div className="rounded-2xl rounded-br-xs px-4 py-2.5 bg-[#2563eb]/90 text-white shadow-xs">
                        <p className="text-xs whitespace-pre-wrap leading-relaxed">{selectedTicket.message}</p>
                      </div>
                      <p className="text-[9px] text-muted-foreground/50 text-right px-1">
                        {format(new Date(selectedTicket.created_at), 'dd MMM, h:mm a')}
                      </p>
                    </div>
                  </div>

                  {/* Replies Thread */}
                  {messagesLoading ? (
                    <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
                  ) : (
                    messages.map(m => {
                      const isCustomer = m.sender_role === 'customer';
                      if (isCustomer) {
                        return (
                          <div key={m.id} className="flex justify-end gap-2 items-end">
                            <div className="max-w-[85%] sm:max-w-[70%] space-y-1">
                              <div className="rounded-2xl rounded-br-xs px-4 py-2.5 bg-[#2563eb]/90 text-white shadow-xs">
                                {m.attachment_url && (
                                  <div className="mb-2 p-1 rounded-lg bg-white/10">
                                    <AttachmentRenderer url={m.attachment_url} />
                                  </div>
                                )}
                                {m.message && m.message !== '[Attachment]' && (
                                  <p className="text-xs whitespace-pre-wrap leading-relaxed">{m.message}</p>
                                )}
                              </div>
                              <p className="text-[9px] text-muted-foreground/50 text-right px-1">
                                {format(new Date(m.created_at), 'h:mm a')}
                              </p>
                            </div>
                          </div>
                        );
                      }

                      // Support reply (Left side)
                      return (
                        <div key={m.id} className="flex justify-start gap-2 items-end">
                          <div className="w-6 h-6 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold text-[9px] shrink-0 mb-4">
                            S
                          </div>
                          <div className="max-w-[85%] sm:max-w-[70%] space-y-1">
                            <div className="rounded-2xl rounded-bl-xs px-4 py-2.5 bg-card border border-border/70 text-foreground shadow-xs">
                              {m.attachment_url && (
                                <div className="mb-2">
                                  <AttachmentRenderer url={m.attachment_url} />
                                </div>
                              )}
                              {m.message && m.message !== '[Attachment]' && (
                                <p className="text-xs whitespace-pre-wrap leading-relaxed">{m.message}</p>
                              )}
                            </div>
                            <p className="text-[9px] text-muted-foreground/50 px-1">
                              Support · {format(new Date(m.created_at), 'h:mm a')}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Reply Composer */}
                <div className="p-3 border-t border-border/50 bg-card shrink-0">
                  {attachment && (
                    <div className="flex items-center justify-between mb-2 px-3 py-1.5 rounded-xl bg-muted/60 text-xs">
                      <span className="truncate max-w-[260px] text-muted-foreground">{attachment.name}</span>
                      <button type="button" onClick={() => setAttachment(null)} className="text-destructive">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                  <form
                    onSubmit={(e) => { e.preventDefault(); sendReply(); }}
                    className="flex items-center gap-2"
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
                      className="h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground shrink-0"
                    >
                      <Paperclip className="w-4 h-4" />
                    </Button>
                    <Input
                      placeholder="Type a message..."
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      className="h-10 text-xs rounded-xl bg-muted/40 border-border/60"
                    />
                    <Button
                      type="submit"
                      disabled={sending || (!replyText.trim() && !attachment)}
                      size="icon"
                      className="h-10 w-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shrink-0 shadow-xs"
                    >
                      {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </Button>
                  </form>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border/70 p-12 text-center bg-card/40 flex flex-col items-center justify-center min-h-[400px]">
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center mb-3">
                  <MessageSquare className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">Select a conversation</h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  Choose a chat on the left to read messages and reply, or start a new conversation.
                </p>
                <Button onClick={() => setCreateOpen(true)} size="sm" className="mt-4 gap-2 text-xs rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white">
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
