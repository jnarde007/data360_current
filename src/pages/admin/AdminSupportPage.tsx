import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { supabase } from '@/integrations/supabase/client';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/StatusBadge';
import { Pagination } from '@/components/Pagination';
import { DateFilter, filterByDate, type DatePreset } from '@/components/DateFilter';
import { AttachmentRenderer } from '@/components/support/AttachmentRenderer';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, Send, LifeBuoy, Search, X, Paperclip, FileText, Image as ImageIcon, Hash, Layers, AlertTriangle, Tag, User, Bell } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { motion } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';

const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } };
const PAGE_SIZE = 15;

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
  created_at: string;
}

const priorityColors: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  high: 'bg-destructive/10 text-destructive',
};

const CATEGORIES = ['All', 'Order delayed', 'Order failed', 'Wrong bundle received', 'Wallet top-up issue', 'Payment issue', 'Refund issue', 'Account issue', 'Other'];
const STATUSES = ['all', 'open', 'pending', 'resolved', 'closed'];
const PRIORITIES_FILTER = ['all', 'low', 'medium', 'high'];

export default function AdminSupportPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [relatedOrderShortId, setRelatedOrderShortId] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const deepLinkedRef = useRef(false);

  const loadTickets = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      setTickets((data || []) as any);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTickets(); }, [loadTickets]);
  useRealtimeRefresh(['support_tickets' as any], loadTickets, 'admin-tickets-live');

  // Deep-link: auto-open ticket from ?ticket= param
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

  const filtered = useMemo(() => {
    return filterByDate(
      tickets.filter(t => {
        if (statusFilter !== 'all' && t.status !== statusFilter) return false;
        if (categoryFilter !== 'All' && t.category !== categoryFilter) return false;
        if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          if (!t.short_id.toLowerCase().includes(q) && !t.subject.toLowerCase().includes(q)) return false;
        }
        return true;
      }),
      (t: Ticket) => t.created_at,
      datePreset, customDate
    );
  }, [tickets, statusFilter, categoryFilter, priorityFilter, search, datePreset, customDate]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
    } catch {
      // silent
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  const openTicket = async (ticket: Ticket) => {
    setSelectedTicket(ticket);
    loadMessages(ticket.id);
    const { data } = await supabase.from('customers').select('full_name, email').eq('id', ticket.customer_id).single();
    setCustomerName(data?.full_name || 'Unknown');
    setCustomerEmail(data?.email || '');
    if (ticket.related_order_id) {
      const { data: orderData } = await supabase.from('orders').select('short_id').eq('id', ticket.related_order_id).single();
      setRelatedOrderShortId(orderData?.short_id || null);
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
      .channel(`admin-ticket-msgs-${selectedTicket.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'support_messages',
        filter: `ticket_id=eq.${selectedTicket.id}`,
      }, (payload) => {
        const msg = payload.new as any;
        setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedTicket?.id]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const maxSize = 5 * 1024 * 1024;
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      toast({ title: 'Invalid file type', description: 'Only PNG, JPG, WebP, and PDF files are allowed.', variant: 'destructive' });
      return;
    }
    if (file.size > maxSize) {
      toast({ title: 'File too large', description: 'Maximum file size is 5MB.', variant: 'destructive' });
      return;
    }
    setAttachment(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const sendReply = async () => {
    if ((!replyText.trim() && !attachment) || !selectedTicket || !user) return;
    setSending(true);
    try {
      let attachmentUrl: string | null = null;
      if (attachment) {
        const ext = attachment.name.split('.').pop()?.toLowerCase() || 'bin';
        const path = `admin/${selectedTicket.id}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from('support-attachments').upload(path, attachment);
        if (uploadErr) throw uploadErr;
        const { data: urlData } = supabase.storage.from('support-attachments').getPublicUrl(path);
        attachmentUrl = urlData.publicUrl;
      }
      const { error } = await supabase.from('support_messages').insert({
        ticket_id: selectedTicket.id,
        sender_id: user.id,
        sender_role: 'admin',
        message: replyText.trim() || (attachmentUrl ? '[Attachment]' : ''),
        attachment_url: attachmentUrl,
      } as any);
      if (error) throw error;
      setReplyText('');
      setAttachment(null);
      toast({ title: 'Reply sent', description: 'Your reply has been sent to the customer.' });
    } catch {
      toast({ title: 'Failed to send', description: 'Could not send your reply. Please try again.', variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const changeStatus = async (newStatus: string) => {
    if (!selectedTicket) return;
    await supabase.from('support_tickets').update({ status: newStatus } as any).eq('id', selectedTicket.id);
    setSelectedTicket(prev => prev ? { ...prev, status: newStatus } : null);
    loadTickets();
  };

  const resetFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setCategoryFilter('All');
    setPriorityFilter('all');
    setDatePreset('all');
    setCustomDate(undefined);
    setPage(1);
  };

  // ─── Ticket Detail View ───
  let threadView: JSX.Element | null = null;
  if (selectedTicket) {
    const customerInitial = customerName.charAt(0).toUpperCase() || 'C';
    threadView = (
        <div className="space-y-4">
          {/* ── Compact Ticket Header Bar ── */}
          <div className="rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm p-3.5 sm:p-4 shadow-sm space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => { setSelectedTicket(null); setRelatedOrderShortId(null); setAttachment(null); }}
                  className="h-8 w-8 shrink-0 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                  title="Back to Tickets"
                >
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-md">
                      #{selectedTicket.short_id}
                    </span>
                    <h1 className="text-sm sm:text-base font-semibold text-foreground truncate">{selectedTicket.subject}</h1>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Select value={selectedTicket.status} onValueChange={changeStatus}>
                  <SelectTrigger className="w-[125px] h-8 text-xs shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.filter(s => s !== 'all').map(s => (
                      <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Customer info & tags inline row */}
            <div className="flex items-center gap-2 flex-wrap text-xs pt-2 border-t border-border/40">
              <div className="flex items-center gap-1.5 mr-1">
                <span className="w-5 h-5 rounded-full bg-secondary flex items-center justify-center text-[10px] font-bold text-muted-foreground">
                  {customerInitial}
                </span>
                <span className="text-xs font-medium text-foreground">{customerName}</span>
                {customerEmail && <span className="text-[10px] text-muted-foreground/60 hidden sm:inline">({customerEmail})</span>}
              </div>

              <Badge variant="outline" className={`text-[10px] capitalize ${priorityColors[selectedTicket.priority]}`}>
                {selectedTicket.priority}
              </Badge>
              <Badge variant="secondary" className="text-[10px]">
                {selectedTicket.category}
              </Badge>
              {relatedOrderShortId && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/5 text-primary border border-primary/15 text-[10px] font-mono font-medium">
                  🧾 Order: #{relatedOrderShortId}
                </span>
              )}
              {selectedTicket.related_wallet_transaction_id && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/5 text-primary border border-primary/15 text-[10px] font-mono font-medium">
                  💳 Wallet Txn
                </span>
              )}
              <span className="ml-auto text-[10px] text-muted-foreground/60 hidden sm:inline">
                {format(new Date(selectedTicket.created_at), 'dd MMM yyyy, h:mm a')}
              </span>
            </div>
          </div>

          {/* ── Chat Messages Stream ── */}
          <div className="space-y-4 pt-2 pb-1">
            {/* Initial customer message (incoming on left for Admin) */}
            <div className="flex justify-start gap-2.5 items-end">
              <div className="shrink-0 w-7 h-7 rounded-full bg-muted border border-border/70 flex items-center justify-center shadow-sm">
                <span className="text-[10px] font-bold text-muted-foreground">{customerInitial}</span>
              </div>
              <div className="max-w-[85%] sm:max-w-[72%] space-y-1">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[11px] font-medium text-foreground">{customerName}</span>
                  <span className="text-[10px] text-muted-foreground/50">
                    {format(new Date(selectedTicket.created_at), 'dd MMM, h:mm a')}
                  </span>
                </div>
                <div className="rounded-2xl rounded-bl-xs px-4 py-2.5 bg-slate-100 dark:bg-slate-800/90 text-slate-900 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700/60 shadow-sm">
                  <p className="text-[13px] whitespace-pre-wrap leading-relaxed">{selectedTicket.message}</p>
                </div>
              </div>
            </div>

            {/* Replies Thread */}
            {messagesLoading ? (
              <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
            ) : messages.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-xs text-muted-foreground/50">No replies in this thread yet.</p>
              </div>
            ) : (
              messages.map(m => {
                const isAdmin = m.sender_role === 'admin';
                const senderLabel = isAdmin ? 'You (Admin)' : customerName;
                const avatarLetter = isAdmin ? 'A' : customerInitial;

                if (isAdmin) {
                  return (
                    <div key={m.id} className="flex justify-end gap-2.5 items-end">
                      <div className="max-w-[85%] sm:max-w-[72%] space-y-1">
                        <div className="flex items-center justify-end gap-2 px-1">
                          <span className="text-[11px] font-medium text-muted-foreground">{senderLabel}</span>
                          <span className="text-[10px] text-muted-foreground/50">
                            {format(new Date(m.created_at), 'h:mm a')}
                          </span>
                        </div>
                        <div className="rounded-2xl rounded-br-xs px-4 py-2.5 bg-blue-600 text-white shadow-sm">
                          {m.attachment_url && (
                            <div className="mb-2 p-1.5 rounded-lg bg-white/10 backdrop-blur-xs">
                              <AttachmentRenderer url={m.attachment_url} />
                            </div>
                          )}
                          {m.message && m.message !== '[Attachment]' && (
                            <p className="text-[13px] whitespace-pre-wrap leading-relaxed">{m.message}</p>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 w-7 h-7 rounded-full bg-blue-600/15 border border-blue-500/25 flex items-center justify-center shadow-sm">
                        <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400">{avatarLetter}</span>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={m.id} className="flex justify-start gap-2.5 items-end">
                    <div className="shrink-0 w-7 h-7 rounded-full bg-muted border border-border/70 flex items-center justify-center shadow-sm">
                      <span className="text-[10px] font-bold text-muted-foreground">{avatarLetter}</span>
                    </div>
                    <div className="max-w-[85%] sm:max-w-[72%] space-y-1">
                      <div className="flex items-center gap-2 px-1">
                        <span className="text-[11px] font-medium text-foreground">{senderLabel}</span>
                        <span className="text-[10px] text-muted-foreground/50">
                          {format(new Date(m.created_at), 'h:mm a')}
                        </span>
                      </div>
                      <div className="rounded-2xl rounded-bl-xs px-4 py-2.5 bg-slate-100 dark:bg-slate-800/90 text-slate-900 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700/60 shadow-sm">
                        {m.attachment_url && (
                          <div className="mb-2">
                            <AttachmentRenderer url={m.attachment_url} />
                          </div>
                        )}
                        {m.message && m.message !== '[Attachment]' && (
                          <p className="text-[13px] whitespace-pre-wrap leading-relaxed">{m.message}</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* ── Reply Composer ── */}
          <Card className="overflow-hidden border-border/50 shadow-sm">
            <CardContent className="p-0">
              {attachment && (
                <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-border/30 bg-muted/30">
                  {attachment.type.startsWith('image/') ? (
                    <ImageIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                  <span className="truncate text-foreground text-xs font-medium">{attachment.name}</span>
                  <span className="text-muted-foreground/50 text-[10px] shrink-0">
                    ({(attachment.size / 1024).toFixed(0)} KB)
                  </span>
                  <button onClick={() => setAttachment(null)} className="ml-auto shrink-0 p-1 rounded-md hover:bg-muted transition-colors">
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                </div>
              )}

              <div className="p-3">
                <Textarea
                  placeholder="Type your reply..."
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  rows={2}
                  className="resize-none border-0 shadow-none focus-visible:ring-0 px-1 text-[13px]"
                  maxLength={2000}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendReply();
                    }
                  }}
                />
              </div>

              <div className="flex items-center justify-between px-3 pb-3">
                <div className="flex items-center gap-1">
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
                    className="h-8 w-8 text-muted-foreground/60 hover:text-muted-foreground"
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach file"
                  >
                    <Paperclip className="w-4 h-4" />
                  </Button>
                </div>
                <Button
                  size="sm"
                  onClick={sendReply}
                  disabled={sending || (!replyText.trim() && !attachment)}
                  className="h-8 px-4 gap-1.5 text-xs"
                >
                  {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Send
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
    );
  }

  // ─── Inbox + Thread Workspace ───
  return (
    <AdminLayout>
      <div className="space-y-5">
        <div className={selectedTicket ? 'hidden lg:block' : 'block'}>
          <h1 className="text-xl lg:text-2xl font-display font-bold text-foreground">Support Tickets</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Manage customer support requests · {filtered.length} shown</p>
        </div>

        <div className="lg:grid lg:grid-cols-[minmax(320px,400px)_1fr] lg:gap-5 lg:items-start">
          <div className={`${selectedTicket ? 'hidden lg:block' : 'block'} space-y-3 lg:sticky lg:top-24`}>
        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10 pointer-events-none" />
            <Input placeholder="Search tickets..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9 h-9 text-sm" />
          </div>
          <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="flex-1 min-w-[100px] h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{s === 'all' ? 'All Status' : s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={v => { setCategoryFilter(v); setPage(1); }}>
            <SelectTrigger className="flex-1 min-w-[130px] h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c === 'All' ? 'All Categories' : c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={v => { setPriorityFilter(v); setPage(1); }}>
            <SelectTrigger className="flex-1 min-w-[100px] h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRIORITIES_FILTER.map(p => <SelectItem key={p} value={p} className="capitalize">{p === 'all' ? 'All Priority' : p}</SelectItem>)}
            </SelectContent>
          </Select>
          <DateFilter datePreset={datePreset} onPresetChange={v => { setDatePreset(v); setPage(1); }} customDate={customDate} onCustomDateChange={setCustomDate} />
          {(search || statusFilter !== 'all' || categoryFilter !== 'All' || priorityFilter !== 'all' || datePreset !== 'all') && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="h-9 gap-1 text-xs">
              <X className="w-3 h-3" /> Reset
            </Button>
          )}
        </div>


            {loading ? (
              <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 glass-card">
                <LifeBuoy className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-sm font-medium text-muted-foreground">No support tickets found</p>
              </div>
            ) : (
              <>
                <div className="space-y-2 lg:max-h-[calc(100vh-20rem)] lg:overflow-y-auto lg:pr-1">
                  {paged.map(t => {
                    const active = selectedTicket?.id === t.id;
                    return (
                      <button key={t.id} onClick={() => openTicket(t)}
                        className={`w-full text-left rounded-2xl border p-3.5 transition-colors ${active ? 'border-primary/40 bg-primary/5' : 'border-border/50 bg-card hover:bg-muted/40'}`}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-foreground truncate">{t.subject}</p>
                          {t.status === 'open' || t.status === 'pending' ? (
                            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[11px] font-semibold border border-amber-500/20 shrink-0">
                              <Bell className="w-3 h-3 fill-amber-500 shrink-0" />
                              <span>Active</span>
                            </span>
                          ) : t.status === 'resolved' ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-medium border border-emerald-500/20 shrink-0">
                              Resolved
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium shrink-0">
                              Closed
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-1">{t.message}</p>
                        <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground/70">
                          <span className="font-mono">{t.short_id}</span>
                          <span className="truncate">{t.category}</span>
                          <Badge variant="outline" className={`text-[9px] px-1.5 py-0 capitalize ${priorityColors[t.priority]}`}>{t.priority}</Badge>
                          <span className="ml-auto shrink-0">{formatDistanceToNow(new Date(t.updated_at), { addSuffix: true })}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
              </>
            )}
          </div>

          <div className={selectedTicket ? 'block' : 'hidden lg:block'}>
            {threadView ?? (
              <div className="glass-card flex flex-col items-center justify-center text-center py-24 px-6">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                  <LifeBuoy className="w-6 h-6 text-primary" />
                </div>
                <p className="text-sm font-semibold text-foreground">Select a ticket</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">Choose a ticket on the left to read the conversation and reply.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
