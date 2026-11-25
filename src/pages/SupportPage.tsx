import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { CustomerLayout } from '@/components/CustomerLayout';
import { supabase } from '@/integrations/supabase/client';
import { AttachmentRenderer } from '@/components/support/AttachmentRenderer';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2, Send, Paperclip, MessageSquare, Trash2,
  ExternalLink, CheckCheck, RefreshCw, Headphones, Calendar, Flag, X
} from 'lucide-react';
import { format, isToday, isYesterday, isSameDay } from 'date-fns';

interface Message {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_role: string;
  message: string;
  attachment_url: string | null;
  read_at: string | null;
  created_at: string;
}

function formatChatDateBadge(date: Date): string {
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays >= 0 && diffDays < 6) return format(date, 'EEEE');
  return format(date, 'MMM d, yyyy');
}

export default function SupportPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const urlTicketId = searchParams.get('ticket');

  const [customerId, setCustomerId] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(urlTicketId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Report to Admin modal state
  const [reportOpen, setReportOpen] = useState(false);
  const [reportCategory, setReportCategory] = useState('Order / Bundle Issue');
  const [reportDetails, setReportDetails] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback((instant = true) => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'end' });
  }, []);

  const resolveCustomerAndTicket = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      let resolvedCustId: string | null = null;

      const { data: custData, error: custErr } = await supabase
        .from('customers')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!custErr && custData?.id) {
        resolvedCustId = custData.id;
        setCustomerId(custData.id);
      }

      if (urlTicketId) {
        setTicketId(urlTicketId);
        return;
      }

      if (resolvedCustId) {
        const { data: rpcTicket, error: rpcErr } = await supabase.rpc(
          'get_or_create_customer_chat',
          { p_customer_id: resolvedCustId }
        );

        if (!rpcErr && rpcTicket) {
          const idVal = typeof rpcTicket === 'string' ? rpcTicket : (rpcTicket as any)?.id || (rpcTicket as any)?.ticket_id;
          if (idVal) {
            setTicketId(idVal);
            return;
          }
        }

        const { data: latestTicket } = await supabase
          .from('support_tickets')
          .select('id')
          .eq('customer_id', resolvedCustId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestTicket?.id) {
          setTicketId(latestTicket.id);
          return;
        }
      }

      // Fallback if ticket is linked directly to auth user_id
      const { data: directTicket } = await supabase
        .from('support_tickets')
        .select('id')
        .eq('customer_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (directTicket?.id) {
        setTicketId(directTicket.id);
      }
    } catch (err: any) {
      console.error('Error initializing support chat:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id, urlTicketId]);

  useEffect(() => {
    resolveCustomerAndTicket();
  }, [resolveCustomerAndTicket]);

  const loadMessages = useCallback(async (tId: string) => {
    try {
      setMessagesLoading(true);
      const { data, error } = await supabase
        .from('support_messages')
        .select('*')
        .eq('ticket_id', tId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages((data || []) as Message[]);

      setTimeout(() => scrollToBottom(true), 30);
      setTimeout(() => scrollToBottom(true), 150);

      // Isolate read RPC so a 400 never hides loaded history
      try {
        await supabase.rpc('mark_support_messages_read', {
          p_ticket_id: tId,
          p_reader_role: 'customer'
        });
      } catch (readErr) {
        console.warn('mark_support_messages_read skipped/failed:', readErr);
      }
    } catch (err: any) {
      console.error('Error loading messages:', err);
    } finally {
      setMessagesLoading(false);
    }
  }, [scrollToBottom]);

  useEffect(() => {
    if (ticketId) loadMessages(ticketId);
  }, [ticketId, loadMessages]);

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
            return [...prev, newMsg];
          });
          setTimeout(() => scrollToBottom(false), 50);

          if (newMsg.sender_role === 'admin') {
            supabase.rpc('mark_support_messages_read', {
              p_ticket_id: ticketId,
              p_reader_role: 'customer'
            }).catch(() => {});
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'support_messages',
        },
        (payload) => {
          const deletedId = (payload.old as any)?.id;
          if (deletedId) {
            setMessages((prev) => prev.filter((m) => m.id !== deletedId));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ticketId, scrollToBottom]);

  const ensureTicketExists = useCallback(async (): Promise<string | null> => {
    if (ticketId) return ticketId;
    const ownerId = customerId || user?.id;
    if (!ownerId) return null;

    if (customerId) {
      const { data: rpcTicket, error: rpcErr } = await supabase.rpc(
        'get_or_create_customer_chat',
        { p_customer_id: customerId }
      );
      if (!rpcErr && rpcTicket) {
        const idVal = typeof rpcTicket === 'string' ? rpcTicket : (rpcTicket as any)?.id || (rpcTicket as any)?.ticket_id;
        if (idVal) {
          setTicketId(idVal);
          return idVal;
        }
      }
    }

    const { data: created, error: createErr } = await supabase
      .from('support_tickets')
      .insert({ customer_id: ownerId, subject: 'Live Support Chat', status: 'open' })
      .select('id')
      .single();

    if (!createErr && created?.id) {
      setTicketId(created.id);
      return created.id;
    }
    return null;
  }, [ticketId, customerId, user?.id]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!replyText.trim() && !attachment) || sending) return;

    setSending(true);
    try {
      const activeTicketId = await ensureTicketExists();
      if (!activeTicketId) {
        throw new Error('Could not find or create a support ticket for your account.');
      }

      let attachmentUrl: string | null = null;
      if (attachment) {
        const ext = attachment.name.split('.').pop();
        const filePath = `${user?.id || 'cust'}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('support-attachments')
          .upload(filePath, attachment);

        if (!uploadErr) {
          const { data: urlData } = supabase.storage
            .from('support-attachments')
            .getPublicUrl(filePath);
          attachmentUrl = urlData?.publicUrl || null;
        }
      }

      const senderId = customerId || user?.id || 'customer';
      const { data: inserted, error: insertErr } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: activeTicketId,
          sender_id: senderId,
          sender_role: 'customer',
          message: replyText.trim() || (attachmentUrl ? '[Attachment]' : ''),
          attachment_url: attachmentUrl,
        })
        .select('*')
        .single();

      if (insertErr) throw insertErr;

      if (inserted) {
        setMessages((prev) => (prev.some((m) => m.id === inserted.id) ? prev : [...prev, inserted as Message]));
      }
      setReplyText('');
      setAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setTimeout(() => scrollToBottom(true), 50);
    } catch (err: any) {
      toast({ title: 'Message failed', description: err.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const handleReportToAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportDetails.trim() || submittingReport) return;

    setSubmittingReport(true);
    try {
      const activeTicketId = await ensureTicketExists();
      if (!activeTicketId) {
        throw new Error('Unable to open a support ticket to send your report.');
      }

      const formattedReport = `[REPORT TO ADMIN - ${reportCategory}]\n${reportDetails.trim()}`;
      const senderId = customerId || user?.id || 'customer';

      const { data: inserted, error: insertErr } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: activeTicketId,
          sender_id: senderId,
          sender_role: 'customer',
          message: formattedReport,
          attachment_url: null,
        })
        .select('*')
        .single();

      if (insertErr) throw insertErr;

      if (inserted) {
        setMessages((prev) => (prev.some((m) => m.id === inserted.id) ? prev : [...prev, inserted as Message]));
      }
      setReportDetails('');
      setReportOpen(false);
      toast({ title: 'Report sent to admin', description: 'Your report has been delivered to the support team.' });
      setTimeout(() => scrollToBottom(true), 50);
    } catch (err: any) {
      toast({ title: 'Report failed', description: err.message, variant: 'destructive' });
    } finally {
      setSubmittingReport(false);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!window.confirm('Delete this message?')) return;
    try {
      setDeletingId(messageId);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));

      const { error: rpcErr } = await supabase.rpc('delete_support_message', {
        p_message_id: messageId
      });

      if (rpcErr) {
        await supabase.from('support_messages').delete().eq('id', messageId);
      }
      toast({ title: 'Message deleted' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Could not delete message', variant: 'destructive' });
      if (ticketId) loadMessages(ticketId);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <CustomerLayout>
      <div className="max-w-4xl mx-auto h-[calc(100dvh-7.5rem)] min-h-[480px] flex flex-col bg-background rounded-2xl border shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3 border-b bg-card/80 backdrop-blur-sm flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative shrink-0">
              <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                <Headphones className="w-5 h-5" />
              </div>
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground truncate">Data360 Live Support</h2>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Support Team • Online
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => composerInputRef.current?.focus()}
              className="hidden md:inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Live Support
            </button>

            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 transition-colors"
            >
              <Flag className="w-3.5 h-3.5" />
              Report to Admin
            </button>

            <button
              type="button"
              onClick={() => {
                if (ticketId) loadMessages(ticketId);
                else resolveCustomerAndTicket();
              }}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
              title="Refresh messages"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            <a
              href="https://wa.me/233538804961"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors"
            >
              WhatsApp Support
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* Message Container with Auto-Scroll to Bottom */}
        <div
          ref={scrollContainerRef}
          className="flex-1 p-4 md:p-6 overflow-y-auto bg-muted/20 space-y-3"
        >
          {loading || messagesLoading ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <p className="text-xs">Connecting to support chat...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground max-w-sm mx-auto">
              <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3">
                <MessageSquare className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-medium text-foreground mb-1">Welcome to Data360 Support</h3>
              <p className="text-xs text-muted-foreground mb-4">
                Have a question about an order, bundle, or top-up? Send a live message below or report an issue to admin.
              </p>
              <button
                type="button"
                onClick={() => setReportOpen(true)}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3.5 py-2 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25 transition-colors"
              >
                <Flag className="w-3.5 h-3.5" />
                Report an Issue to Admin
              </button>
            </div>
          ) : (
            messages.map((msg, index) => {
              const isMe = msg.sender_role === 'customer';
              const currentDate = new Date(msg.created_at);
              const prevDate = index > 0 ? new Date(messages[index - 1].created_at) : null;
              const showDateBadge = !prevDate || !isSameDay(currentDate, prevDate);

              return (
                <div key={msg.id} className="space-y-3">
                  {showDateBadge && (
                    <div className="flex justify-center my-4 select-none">
                      <div className="px-3.5 py-1 rounded-full bg-slate-200/90 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold shadow-xs border border-border/50 flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-primary" />
                        <span>{formatChatDateBadge(currentDate)}</span>
                      </div>
                    </div>
                  )}

                  <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} my-1`}>
                    <div className="flex items-center gap-2 max-w-[85%] sm:max-w-[75%]">
                      {isMe && (
                        <button
                          type="button"
                          onClick={() => handleDeleteMessage(msg.id)}
                          disabled={deletingId === msg.id}
                          className="p-1.5 text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 rounded-full transition-all shrink-0"
                          title="Delete message"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <div
                        className={`rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                          isMe
                            ? 'bg-primary text-primary-foreground rounded-br-xs'
                            : 'bg-card text-card-foreground border border-border/60 rounded-bl-xs'
                        }`}
                      >
                        {!isMe && (
                          <div className="text-xs font-bold text-sky-600 dark:text-sky-400 mb-1">
                            Data360 Support
                          </div>
                        )}

                        <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.message}</p>

                        {msg.attachment_url && (
                          <div className="mt-2">
                            <AttachmentRenderer url={msg.attachment_url} />
                          </div>
                        )}

                        <div
                          className={`flex items-center justify-end gap-1.5 mt-1 text-[10px] select-none ${
                            isMe ? 'text-primary-foreground/75' : 'text-muted-foreground'
                          }`}
                        >
                          <span>
                            {isToday(currentDate) ? format(currentDate, 'h:mm a') : format(currentDate, 'MMM d, h:mm a')}
                          </span>
                          {isMe && (
                            <CheckCheck
                              className={`w-3.5 h-3.5 ${msg.read_at ? 'text-sky-300' : 'opacity-60'}`}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Attachment preview */}
        {attachment && (
          <div className="px-4 py-2 bg-muted/40 border-t flex items-center justify-between text-xs">
            <span className="truncate max-w-xs font-medium text-foreground">📎 {attachment.name}</span>
            <button
              type="button"
              onClick={() => {
                setAttachment(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
              className="text-muted-foreground hover:text-destructive"
            >
              ✕ Remove
            </button>
          </div>
        )}

        {/* Composer */}
        <form onSubmit={handleSendMessage} className="p-3 bg-card border-t flex items-center gap-2 shrink-0">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/*,application/pdf"
            onChange={(e) => {
              if (e.target.files?.[0]) setAttachment(e.target.files[0]);
            }}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full transition-colors"
            title="Attach file"
          >
            <Paperclip className="w-5 h-5" />
          </button>

          <input
            ref={composerInputRef}
            type="text"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 bg-muted/50 border border-input/60 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:bg-background transition-all"
          />

          <button
            type="submit"
            disabled={(!replyText.trim() && !attachment) || sending}
            className="p-2.5 rounded-full bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity"
            title="Send"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </form>
      </div>

      {/* Report to Admin Modal */}
      {reportOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-card text-card-foreground border rounded-2xl shadow-lg w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flag className="w-4 h-4 text-amber-600" />
                <h3 className="text-sm font-semibold">Report Issue to Admin</h3>
              </div>
              <button
                type="button"
                onClick={() => setReportOpen(false)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleReportToAdmin} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Issue Category
                </label>
                <select
                  value={reportCategory}
                  onChange={(e) => setReportCategory(e.target.value)}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="Order / Bundle Issue">Order / Bundle Issue</option>
                  <option value="Payment / Top-up Issue">Payment / Top-up Issue</option>
                  <option value="Account / Login Issue">Account / Login Issue</option>
                  <option value="Other Report">Other Report</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Details for Admin
                </label>
                <textarea
                  rows={4}
                  required
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  placeholder="Include your phone number, transaction/order reference, and what happened..."
                  className="w-full rounded-lg border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setReportOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg border text-xs font-medium hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!reportDetails.trim() || submittingReport}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-40"
                >
                  {submittingReport && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Submit Report
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </CustomerLayout>
  );
}
