import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/StatusBadge';
import { AttachmentRenderer } from '@/components/support/AttachmentRenderer';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, Send, LifeBuoy, Search, X, Paperclip, MessageSquare, CheckCheck, RefreshCw } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { useSearchParams } from 'react-router-dom';

const STATUSES = ['all', 'open', 'in_progress', 'resolved', 'closed'];

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
}

interface Message {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_role: string;
  message: string;
  attachment_url: string | null;
  read_at?: string | null;
  created_at: string;
}

export default function AdminSupportPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [unreadMap, setUnreadMap] = useState<Record<string, number>>({});
  const [customers, setCustomers] = useState<Record<string, { name: string; phone: string; email: string }>>({});
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [relatedOrderShortId, setRelatedOrderShortId] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadUnreadCounts = useCallback(async (ticketIds: string[]) => {
    if (!ticketIds.length) return;
    try {
      const { data, error } = await supabase
        .from('support_messages')
        .select('ticket_id')
        .in('ticket_id', ticketIds)
        .eq('sender_role', 'customer')
        .is('read_at', null);

      if (error) return;
      const counts: Record<string, number> = {};
      data?.forEach((m: any) => {
        counts[m.ticket_id] = (counts[m.ticket_id] || 0) + 1;
      });
      setUnreadMap(counts);
    } catch (err) {
      console.error('Failed to load admin unread counts:', err);
    }
  }, []);

  const loadTickets = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      const list = (data as Ticket[]) || [];
      setTickets(list);

      if (list.length > 0) {
        loadUnreadCounts(list.map(t => t.id));
        const customerIds = [...new Set(list.map(t => t.customer_id))];
        const { data: custData } = await supabase
          .from('customers')
          .select('id, full_name, phone, email')
          .in('id', customerIds);

        const map: Record<string, { name: string; phone: string; email: string }> = {};
        custData?.forEach(c => {
          map[c.id] = { name: c.full_name || 'Customer', phone: c.phone || '', email: c.email || '' };
        });
        setCustomers(map);
      }
    } catch (err: any) {
      console.error('Failed to load tickets:', err);
    } finally {
      setLoading(false);
    }
  }, [loadUnreadCounts]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  useRealtimeRefresh(['support_tickets', 'support_messages'], () => {
    loadTickets();
    if (selectedTicket) {
      loadMessages(selectedTicket.id);
    }
  });

  const markAsRead = async (ticketId: string) => {
    try {
      await supabase.rpc('mark_support_messages_read', { p_ticket_id: ticketId });
      setUnreadMap(prev => {
        const next = { ...prev };
        delete next[ticketId];
        return next;
      });
    } catch (err) {
      console.error('Failed to mark read:', err);
    }
  };

  const loadMessages = async (ticketId: string) => {
    setMessagesLoading(true);
    try {
      const { data, error } = await supabase
        .from('support_messages')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages((data as Message[]) || []);
      setTimeout(scrollToBottom, 100);
      markAsRead(ticketId);
    } catch (err: any) {
      console.error('Failed to load messages:', err);
    } finally {
      setMessagesLoading(false);
    }
  };

  const openTicket = async (ticket: Ticket) => {
    setSelectedTicket(ticket);
    setRelatedOrderShortId(null);
    loadMessages(ticket.id);

    if (ticket.related_order_id) {
      try {
        const { data } = await supabase
          .from('orders')
          .select('short_id')
          .eq('id', ticket.related_order_id)
          .maybeSingle();
        if (data?.short_id) setRelatedOrderShortId(data.short_id);
      } catch (err) {
        console.error('Failed to fetch related order:', err);
      }
    }
  };

  useEffect(() => {
    const tId = searchParams.get('id');
    if (tId && tickets.length > 0 && !selectedTicket) {
      const match = tickets.find(t => t.id === tId);
      if (match) openTicket(match);
    }
  }, [searchParams, tickets, selectedTicket]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Maximum file size is 5MB', variant: 'destructive' });
      return;
    }
    setAttachment(file);
  };

  const uploadAttachment = async (): Promise<string | null> => {
    if (!attachment || !user) return null;
    setUploading(true);
    try {
      const ext = attachment.name.split('.').pop();
      const path = `admin/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('support-attachments')
        .upload(path, attachment);
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('support-attachments')
        .getPublicUrl(path);
      return publicUrl;
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
      return null;
    } finally {
      setUploading(false);
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!replyText.trim() && !attachment) || !selectedTicket || !user || sending) return;

    setSending(true);
    try {
      let attachmentUrl: string | null = null;
      if (attachment) {
        attachmentUrl = await uploadAttachment();
        if (!attachmentUrl && !replyText.trim()) {
          setSending(false);
          return;
        }
      }

      const { error } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: selectedTicket.id,
          sender_id: user.id,
          sender_role: 'admin',
          message: replyText.trim() || '[Attachment]',
          attachment_url: attachmentUrl,
        });

      if (error) throw error;

      await supabase
        .from('support_tickets')
        .update({
          status: selectedTicket.status === 'open' ? 'in_progress' : selectedTicket.status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedTicket.id);

      setReplyText('');
      setAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      loadMessages(selectedTicket.id);
      loadTickets();
    } catch (err: any) {
      toast({ title: 'Error sending reply', description: err.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const changeStatus = async (newStatus: string) => {
    if (!selectedTicket) return;
    try {
      const { error } = await supabase
        .from('support_tickets')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', selectedTicket.id);

      if (error) throw error;
      setSelectedTicket({ ...selectedTicket, status: newStatus });
      loadTickets();
      toast({ title: `Status changed to ${newStatus}` });
    } catch (err: any) {
      toast({ title: 'Error updating status', description: err.message, variant: 'destructive' });
    }
  };

  const filtered = useMemo(() => {
    return tickets.filter(t => {
      const cust = customers[t.customer_id];
      const matchSearch =
        t.subject.toLowerCase().includes(search.toLowerCase()) ||
        t.short_id.toLowerCase().includes(search.toLowerCase()) ||
        t.message.toLowerCase().includes(search.toLowerCase()) ||
        (cust?.name && cust.name.toLowerCase().includes(search.toLowerCase())) ||
        (cust?.phone && cust.phone.includes(search));

      const matchStatus = statusFilter === 'all' || t.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [tickets, search, statusFilter, customers]);

  const activeCustomer = selectedTicket ? customers[selectedTicket.customer_id] : null;

  return (
    <AdminLayout>
      <div className="space-y-4">
        <div className={`${selectedTicket ? 'hidden md:flex' : 'flex'} items-center justify-between gap-3`}>
          <div>
            <h1 className="text-xl md:text-2xl font-display font-bold text-foreground">Support Messages</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Manage customer inquiries and live chat · {filtered.length} shown</p>
          </div>
          <Button onClick={loadTickets} variant="outline" size="sm" className="gap-1.5 rounded-xl">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </div>

        {/* Admin Split View */}
        <div className="md:grid md:grid-cols-[minmax(280px,340px)_1fr] lg:grid-cols-[minmax(320px,380px)_1fr] md:gap-4 md:items-start">
          
          {/* Inbox List */}
          <div className={`${selectedTicket ? 'hidden md:block' : 'block'} space-y-2.5 md:sticky md:top-20`}>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70 pointer-events-none" />
                <Input
                  placeholder="Search customer, id..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9 h-10 text-xs rounded-xl bg-card border-border/60"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[110px] h-10 text-xs rounded-xl bg-card border-border/60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map(s => (
                    <SelectItem key={s} value={s} className="capitalize text-xs">{s.replace('_', ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {loading ? (
              <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 rounded-2xl border border-dashed border-border/60 bg-card/40 p-5">
                <LifeBuoy className="w-9 h-9 mx-auto text-muted-foreground/40 mb-2.5" />
                <p className="text-xs font-medium text-muted-foreground">No support messages found</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[calc(100vh-14rem)] overflow-y-auto pr-0.5">
                {filtered.map(t => {
                  const active = selectedTicket?.id === t.id;
                  const cust = customers[t.customer_id];
                  const initial = cust?.name ? cust.name.charAt(0).toUpperCase() : 'C';
                  const unread = unreadMap[t.id] || 0;
                  return (
                    <button
                      key={t.id}
                      onClick={() => openTicket(t)}
                      className={`w-full text-left rounded-xl p-3 transition-all flex items-start gap-3 border ${
                        active
                          ? 'bg-primary/10 border-primary/40 shadow-sm'
                          : 'bg-card border-border/50 hover:bg-muted/40 hover:border-border'
                      }`}
                    >
                      <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs ${
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-secondary text-secondary-foreground border border-border/60'
                      }`}>
                        {initial}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <p className={`text-xs truncate ${unread > 0 ? 'font-bold text-foreground' : 'font-semibold text-foreground'}`}>
                            {cust?.name || t.subject}
                          </p>
                          <span className="text-[10px] text-muted-foreground/70 shrink-0 font-medium">
                            {formatDistanceToNow(new Date(t.updated_at), { addSuffix: false })}
                          </span>
                        </div>
                        <p className={`text-[11px] line-clamp-1 leading-snug ${unread > 0 ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                          {t.message}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[9px] font-mono font-medium px-1.5 py-0.5 rounded bg-muted/80 text-muted-foreground">
                            {t.short_id}
                          </span>
                          <span className="text-[10px] capitalize text-muted-foreground/60">{t.status.replace('_', ' ')}</span>
                          {unread > 0 && (
                            <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-rose-500 text-white shadow-sm">
                              {unread}
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

          {/* Chat Pane */}
          <div className={`${selectedTicket ? 'block' : 'hidden md:block'} rounded-2xl border border-border/60 bg-card overflow-hidden shadow-sm flex flex-col h-[calc(100vh-10rem)] min-h-[500px]`}>
            {selectedTicket ? (
              <>
                <div className="px-4 py-3 border-b border-border/50 bg-muted/20 flex items-center justify-between gap-3 shrink-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => { setSelectedTicket(null); setMessages([]); setRelatedOrderShortId(null); }}
                      className="md:hidden h-8 w-8 rounded-lg shrink-0 -ml-1 text-muted-foreground hover:text-foreground"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </Button>
                    <div className="w-8 h-8 rounded-full bg-secondary text-secondary-foreground border border-border/60 flex items-center justify-center font-bold text-xs shrink-0">
                      {activeCustomer?.name ? activeCustomer.name.charAt(0).toUpperCase() : 'C'}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="text-xs md:text-sm font-semibold text-foreground truncate">
                          {activeCustomer?.name || 'Customer'}
                        </h2>
                        {activeCustomer?.phone && (
                          <span className="text-[10px] text-muted-foreground font-mono">({activeCustomer.phone})</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="font-mono">{selectedTicket.short_id}</span>
                        <span className="truncate">· {selectedTicket.subject}</span>
                        {relatedOrderShortId && (
                          <span className="text-primary font-medium">· Order: {relatedOrderShortId}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Select value={selectedTicket.status} onValueChange={changeStatus}>
                      <SelectTrigger className="w-[110px] h-8 text-xs rounded-lg">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.filter(s => s !== 'all').map(s => (
                          <SelectItem key={s} value={s} className="capitalize text-xs">{s.replace('_', ' ')}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/10">
                  {/* Customer's First Message */}
                  <div className="flex justify-start mb-2">
                    <div className="max-w-[85%] md:max-w-[75%] rounded-2xl rounded-bl-sm px-3.5 py-2.5 bg-card border border-border/60 text-foreground shadow-sm text-xs">
                      <p className="text-[10px] font-bold text-primary mb-1">
                        {activeCustomer?.name || 'Customer'}
                      </p>
                      <p className="whitespace-pre-wrap leading-relaxed">{selectedTicket.message}</p>
                      <div className="flex items-center justify-end gap-1 mt-1 text-[9px] text-muted-foreground/80 font-medium">
                        <span>{format(new Date(selectedTicket.created_at), 'h:mm a')}</span>
                      </div>
                    </div>
                  </div>

                  {messagesLoading ? (
                    <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
                  ) : (
                    messages.map(m => {
                      const isAdmin = m.sender_role === 'admin';
                      return (
                        <div key={m.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-3.5 py-2.5 shadow-sm text-xs ${
                              isAdmin
                                ? 'rounded-br-sm bg-primary/15 border border-primary/20 text-foreground'
                                : 'rounded-bl-sm bg-card border border-border/60 text-foreground'
                            }`}
                          >
                            <p className="text-[10px] font-bold text-primary mb-1">
                              {isAdmin ? 'You (Support)' : activeCustomer?.name || 'Customer'}
                            </p>
                            {m.attachment_url && (
                              <div className="mb-2">
                                <AttachmentRenderer url={m.attachment_url} />
                              </div>
                            )}
                            {m.message && m.message !== '[Attachment]' && (
                              <p className="whitespace-pre-wrap leading-relaxed">{m.message}</p>
                            )}
                            <div className="flex items-center justify-end gap-1 mt-1 text-[9px] text-muted-foreground/80 font-medium">
                              <span>{format(new Date(m.created_at), 'h:mm a')}</span>
                              {isAdmin && <CheckCheck className="w-3 h-3 text-primary" />}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <form onSubmit={handleSend} className="p-2.5 border-t border-border/50 bg-card shrink-0">
                  {attachment && (
                    <div className="flex items-center justify-between gap-2 px-3 py-1.5 mb-2 rounded-lg bg-muted/50 border border-border/40 text-xs text-muted-foreground">
                      <span className="truncate flex items-center gap-1.5">
                        <Paperclip className="w-3.5 h-3.5 text-primary" /> {attachment.name}
                      </span>
                      <button type="button" onClick={() => setAttachment(null)} className="text-muted-foreground hover:text-foreground">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp,.pdf"
                      className="hidden"
                      onChange={handleFileSelect}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => fileInputRef.current?.click()}
                      className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground shrink-0"
                      title="Add attachment"
                    >
                      <Paperclip className="w-4 h-4" />
                    </Button>
                    <Input
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      placeholder="Type reply to customer..."
                      className="h-10 text-xs rounded-full bg-muted/40 border-border/50 px-4 focus-visible:ring-1"
                    />
                    <Button
                      type="submit"
                      size="icon"
                      disabled={sending || (!replyText.trim() && !attachment)}
                      className="h-10 w-10 rounded-full shrink-0 shadow-sm"
                    >
                      {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </Button>
                  </div>
                </form>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
                  <MessageSquare className="w-7 h-7 text-primary" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">Select a conversation</h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  Pick a customer chat from the list to view the conversation and reply.
                </p>
              </div>
            )}
          </div>

        </div>
      </div>
    </AdminLayout>
  );
}
