import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { CustomerLayout } from '@/components/CustomerLayout';
import { supabase } from '@/integrations/supabase/client';
import { useSearchParams } from 'react-router-dom';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { CreateTicketDialog } from '@/components/support/CreateTicketDialog';
import { AttachmentRenderer } from '@/components/support/AttachmentRenderer';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Plus, ArrowLeft, Send, LifeBuoy, Paperclip, Search, MessageSquare, Check, CheckCheck } from 'lucide-react';
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
  const [unreadMap, setUnreadMap] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [search, setSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const deepLinkedRef = useRef(false);

  const loadUnreadCounts = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('support_messages')
        .select('ticket_id')
        .eq('sender_role', 'admin')
        .is('read_at', null);
      if (error) return;
      const counts: Record<string, number> = {};
      (data || []).forEach((row: any) => {
        counts[row.ticket_id] = (counts[row.ticket_id] || 0) + 1;
      });
      setUnreadMap(counts);
    } catch {
      // silent
    }
  }, []);

  const loadTickets = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      setTickets((data || []) as any);
      loadUnreadCounts();
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [user?.id, loadUnreadCounts]);

  useEffect(() => { loadTickets(); }, [loadTickets]);
  useRealtimeRefresh(['support_tickets' as any, 'support_messages' as any], loadTickets, 'customer-tickets-live');

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

      await supabase.rpc('mark_support_messages_read', {
        p_ticket_id: ticketId,
        p_reader_role: 'customer',
      });
      setUnreadMap(prev => ({ ...prev, [ticketId]: 0 }));
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

  useEffect(() => {
    if (!selectedTicket) return;
    const channel = supabase
      .channel(`ticket-msgs-${selectedTicket.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'support_messages',
        filter: `ticket_id=eq.${selectedTicket.id}`,
      }, (payload) => {
        const msg = payload.new as any;
        setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
        if (msg.sender_role === 'admin') {
          supabase.rpc('mark_support_messages_read', {
            p_ticket_id: selectedTicket.id,
            p_reader_role: 'customer',
          });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedTicket?.id]);

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

  const totalUnread = useMemo(() => {
    return Object.values(unreadMap).reduce((acc, count) => acc + (count > 0 ? 1 : 0), 0);
  }, [unreadMap]);

  const visibleTickets = useMemo(() => {
    return tickets.filter(t => {
      if (tab === 'unread' && !(unreadMap[t.id] > 0)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!t.short_id.toLowerCase().includes(q) && !t.subject.toLowerCase().includes(q) && !t.message.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [tickets, tab, search, unreadMap]);

  return (
    <CustomerLayout>
      <div className="space-y-4 max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl lg:text-2xl font-bold tracking-tight text-foreground">Help & Support</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Chat directly with support for quick assistance</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-2 shadow-sm shrink-0">
            <Plus className="w-4 h-4" /> Start a Chat
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[minmax(280px,340px)_1fr] gap-4 items-start">
          {/* Inbox column */}
          <div className={`${selectedTicket ? 'hidden md:block' : 'block'} space-y-2.5`}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10 pointer-events-none" />
              <Input
                placeholder="Search chats..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 h-9 text-xs rounded-xl"
              />
            </div>

            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-muted/60">
              <button
                onClick={() => setTab('all')}
                className={`h-8 rounded-lg text-xs font-semibold transition-all ${tab === 'all' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                All <span className="ml-1 opacity-60">({tickets.length})</span>
              </button>
              <button
                onClick={() => setTab('unread')}
                className={`h-8 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${tab === 'unread' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Unread
                {totalUnread > 0 && (
                  <span className="bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 py-0.2 rounded-full min-w-[18px] text-center">
                    {totalUnread}
                  </span>
                )}
              </button>
            </div>

            {loading ? (
              <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : visibleTickets.length === 0 ? (
              <div className="text-center py-12 rounded-2xl border border-dashed border-border/60 p-6 bg-card">
                <LifeBuoy className="w-9 h-9 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-xs font-medium text-muted-foreground">
                  {tickets.length === 0 ? 'No conversations yet' : tab === 'unread' ? 'All caught up! No unread messages.' : 'No chats found'}
                </p>
                {tickets.length === 0 && (
                  <Button onClick={() => setCreateOpen(true)} size="sm" className="mt-3 text-xs">Start Chat</Button>
                )}
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[calc(100vh-16rem)] overflow-y-auto pr-1">
                {visibleTickets.map(t => {
                  const active = selectedTicket?.id === t.id;
                  const unreadCount = unreadMap[t.id] || 0;
                  return (
                    <button
                      key={t.id}
                      onClick={() => openTicket(t)}
                      className={`w-full text-left rounded-xl border p-3 transition-all ${active ? 'border-primary/50 bg-primary/5 shadow-xs' : 'border-border/40 bg-card hover:bg-muted/40'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-xs truncate ${unreadCount > 0 ? 'font-bold text-foreground' : 'font-medium text-foreground'}`}>
                          {t.subject || 'Support Request'}
                        </p>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {formatDistanceToNow(new Date(t.updated_at), { addSuffix: true })}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <p className="text-[11px] text-muted-foreground line-clamp-1 flex-1">
                          {t.message}
                        </p>
                        {unreadCount > 0 && (
                          <span className="bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center shrink-0">
                            {unreadCount}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1.5 text-[9px] text-muted-foreground/70 font-mono">
                        <span>{t.short_id}</span>
                        {t.category && <span>· {t.category}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Active chat column */}
          <div className={selectedTicket ? 'block' : 'hidden md:block'}>
            {!selectedTicket ? (
              <div className="hidden md:flex flex-col items-center justify-center py-24 text-center rounded-2xl border border-dashed border-border/60 bg-card p-6 min-h-[460px]">
                <MessageSquare className="w-12 h-12 text-muted-foreground/30 mb-3" />
                <h3 className="text-sm font-semibold text-foreground">Select a conversation</h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  Pick a chat on the left to read customer support updates and reply.
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-border/60 bg-card shadow-xs flex flex-col h-[calc(100vh-14rem)] min-h-[480px]">
                {/* Chat header */}
                <div className="p-3 border-b border-border/50 flex items-center justify-between gap-2 bg-muted/20 rounded-t-2xl">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSelectedTicket(null)}
                      className="md:hidden h-8 w-8 -ml-1 text-muted-foreground"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </Button>
                    <div>
                      <h2 className="text-xs sm:text-sm font-bold text-foreground line-clamp-1">{selectedTicket.subject}</h2>
                      <p className="text-[10px] text-muted-foreground font-mono">
                        {selectedTicket.short_id} {relatedOrderShortId ? `· Order: ${relatedOrderShortId}` : ''}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Messages stream */}
                <div className="flex-1 p-3.5 space-y-3 overflow-y-auto">
                  {/* Initial message bubble */}
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl px-3.5 py-2.5 bg-primary text-primary-foreground shadow-xs text-xs">
                      <p className="whitespace-pre-wrap leading-relaxed">{selectedTicket.message}</p>
                      <p className="text-[9px] opacity-70 mt-1 text-right">
                        {format(new Date(selectedTicket.created_at), 'hh:mm a')}
                      </p>
                    </div>
                  </div>

                  {messagesLoading ? (
                    <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                  ) : (
                    messages.map((m) => {
                      const isCustomer = m.sender_role === 'customer';
                      return (
                        <div key={m.id} className={`flex ${isCustomer ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs shadow-xs ${
                              isCustomer
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted/80 text-foreground border border-border/40'
                            }`}
                          >
                            {!isCustomer && (
                              <p className="text-[10px] font-bold text-primary mb-1">Support Agent</p>
                            )}
                            <p className="whitespace-pre-wrap leading-relaxed">{m.message}</p>
                            {m.attachment_url && (
                              <div className="mt-2">
                                <AttachmentRenderer url={m.attachment_url} />
                              </div>
                            )}
                            <p className={`text-[9px] mt-1 text-right ${isCustomer ? 'opacity-70' : 'text-muted-foreground'}`}>
                              {format(new Date(m.created_at), 'hh:mm a')}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Composer */}
                <div className="p-2.5 border-t border-border/50 bg-background/50 rounded-b-2xl space-y-2">
                  {attachment && (
                    <div className="flex items-center gap-2 p-1.5 px-2 bg-muted/60 rounded-lg text-xs">
                      <Paperclip className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="truncate flex-1 text-[11px]">{attachment.name}</span>
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setAttachment(null)}>
                        ✕
                      </Button>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) setAttachment(file);
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 text-muted-foreground"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Paperclip className="w-4 h-4" />
                    </Button>
                    <Input
                      placeholder="Type your message..."
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendReply();
                        }
                      }}
                      className="h-9 text-xs rounded-xl"
                    />
                    <Button
                      size="icon"
                      onClick={sendReply}
                      disabled={sending || (!replyText.trim() && !attachment)}
                      className="h-9 w-9 shrink-0 rounded-xl"
                    >
                      {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <CreateTicketDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={loadTickets} />
      </div>
    </CustomerLayout>
  );
}
