import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AdminLayout } from '@/components/AdminLayout';
import { supabase } from '@/integrations/supabase/client';
import { AttachmentRenderer } from '@/components/support/AttachmentRenderer';
import { useToast } from '@/hooks/use-toast';
import { useSearchParams } from 'react-router-dom';
import { 
  Loader2, Send, Paperclip, Search, Trash2, CheckCheck, 
  RefreshCw, Phone, Mail, MessageSquare, Headphones, ExternalLink, Calendar
} from 'lucide-react';
import { format, isToday, isYesterday, isSameDay } from 'date-fns';

interface AdminChatSummary {
  ticket_id: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  last_message: string;
  last_message_at: string;
  last_message_sender_role: string;
  unread_count: number;
}

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

export default function AdminSupportPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const deepTicketId = searchParams.get('ticket');
  const deepCustomerId = searchParams.get('customer');

  const [chats, setChats] = useState<AdminChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedChat, setSelectedChat] = useState<AdminChatSummary | null>(null);
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback((instant = true) => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'end' });
  }, []);

  const loadChats = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('get_admin_customer_chats');
      if (error) throw error;
      const parsed = (data || []) as AdminChatSummary[];
      setChats(parsed);

      setSelectedChat((prev) => {
        // Match from notification URL param if present
        if (deepTicketId) {
          const match = parsed.find(c => c.ticket_id === deepTicketId);
          if (match) return match;
        }
        if (deepCustomerId) {
          const match = parsed.find(c => c.customer_id === deepCustomerId);
          if (match) return match;
        }
        if (!prev && parsed.length > 0) return parsed[0];
        if (prev) {
          const updated = parsed.find((c) => c.ticket_id === prev.ticket_id);
          return updated || prev;
        }
        return null;
      });
    } catch (err: any) {
      console.error('Error fetching admin chats:', err);
    } finally {
      setLoading(false);
    }
  }, [deepTicketId, deepCustomerId]);

  useEffect(() => { loadChats(); }, [loadChats]);

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

      // Snap to recent messages at the bottom immediately
      setTimeout(() => scrollToBottom(true), 30);
      setTimeout(() => scrollToBottom(true), 150);

      // Mark messages & sync notification bell read state
      await supabase.rpc('mark_support_messages_read', {
        p_ticket_id: tId,
        p_reader_role: 'admin'
      });

      setChats((prev) =>
        prev.map((c) => (c.ticket_id === tId ? { ...c, unread_count: 0 } : c))
      );
    } catch (err: any) {
      console.error('Error loading admin messages:', err);
    } finally {
      setMessagesLoading(false);
    }
  }, [scrollToBottom]);

  useEffect(() => {
    if (selectedChat?.ticket_id) loadMessages(selectedChat.ticket_id);
  }, [selectedChat?.ticket_id, loadMessages]);

  // Realtime updates
  useEffect(() => {
    const channel = supabase
      .channel('admin-chat-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'support_messages',
        },
        (payload) => {
          const newMsg = payload.new as Message;
          if (selectedChat && newMsg.ticket_id === selectedChat.ticket_id) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
            setTimeout(() => scrollToBottom(false), 50);

            if (newMsg.sender_role === 'customer') {
              supabase.rpc('mark_support_messages_read', {
                p_ticket_id: selectedChat.ticket_id,
                p_reader_role: 'admin'
              });
            }
          }
          loadChats();
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
          loadChats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedChat, loadChats, scrollToBottom]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!replyText.trim() && !attachment) || !selectedChat?.ticket_id || sending) return;

    setSending(true);
    try {
      let attachmentUrl: string | null = null;
      if (attachment) {
        const ext = attachment.name.split('.').pop();
        const filePath = `admin/${Date.now()}.${ext}`;
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

      const { error: insertErr } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: selectedChat.ticket_id,
          sender_id: user?.id || 'admin',
          sender_role: 'admin',
          message: replyText.trim() || (attachmentUrl ? '[Attachment]' : ''),
          attachment_url: attachmentUrl,
        });

      if (insertErr) throw insertErr;

      setReplyText('');
      setAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setTimeout(() => scrollToBottom(true), 50);
    } catch (err: any) {
      toast({ title: 'Send failed', description: err.message, variant: 'destructive' });
    } finally {
      setSending(false);
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
      loadChats();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to delete message', variant: 'destructive' });
      if (selectedChat?.ticket_id) loadMessages(selectedChat.ticket_id);
    } finally {
      setDeletingId(null);
    }
  };

  const filteredChats = useMemo(() => {
    return chats.filter((c) => {
      if (filter === 'unread' && c.unread_count === 0) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        c.customer_name?.toLowerCase().includes(q) ||
        c.customer_phone?.toLowerCase().includes(q) ||
        c.customer_email?.toLowerCase().includes(q) ||
        c.last_message?.toLowerCase().includes(q)
      );
    });
  }, [chats, filter, search]);

  const totalUnread = useMemo(() => {
    return chats.reduce((acc, c) => acc + (c.unread_count > 0 ? 1 : 0), 0);
  }, [chats]);

  return (
    <AdminLayout>
      <div className="h-[calc(100vh-7.5rem)] min-h-[500px] flex rounded-2xl border bg-background shadow-sm overflow-hidden">
        {/* Left Pane: Customer List */}
        <div className="w-full md:w-[320px] lg:w-[360px] border-r flex flex-col bg-card shrink-0">
          <div className="p-3.5 border-b space-y-2.5">
            <div className="flex items-center justify-between">
              <h1 className="text-base font-bold text-foreground flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary" />
                Customer Chats
              </h1>
              <button
                onClick={loadChats}
                className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
                title="Refresh inbox"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search name, phone, message..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-muted/50 rounded-lg border border-input/60 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex items-center gap-1.5 text-xs pt-1">
              <button
                onClick={() => setFilter('all')}
                className={`flex-1 py-1 rounded-md font-medium text-center transition-colors ${
                  filter === 'all'
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                All ({chats.length})
              </button>
              <button
                onClick={() => setFilter('unread')}
                className={`flex-1 py-1 rounded-md font-medium text-center transition-colors ${
                  filter === 'unread'
                    ? 'bg-rose-500/10 text-rose-600 font-semibold'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                Unread {totalUnread > 0 && <span className="ml-1 px-1.5 py-0.2 bg-rose-500 text-white rounded-full text-[10px]">{totalUnread}</span>}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-border/40">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground text-xs flex flex-col items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                Loading conversations...
              </div>
            ) : filteredChats.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-xs">
                No conversations found.
              </div>
            ) : (
              filteredChats.map((c) => {
                const isSelected = selectedChat?.ticket_id === c.ticket_id;
                return (
                  <button
                    key={c.ticket_id}
                    onClick={() => setSelectedChat(c)}
                    className={`w-full text-left p-3.5 transition-colors flex items-start gap-3 ${
                      isSelected
                        ? 'bg-primary/10 border-l-4 border-primary'
                        : 'hover:bg-muted/40'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-foreground font-semibold text-xs shrink-0">
                      {c.customer_name ? c.customer_name.substring(0, 2).toUpperCase() : 'CU'}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="font-semibold text-xs text-foreground truncate">
                          {c.customer_name}
                        </span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {c.last_message_at ? formatChatDateBadge(new Date(c.last_message_at)) : ''}
                        </span>
                      </div>

                      <div className="text-[11px] text-muted-foreground truncate mb-1">
                        {c.customer_phone || c.customer_email || 'Customer'}
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground truncate leading-relaxed">
                          {c.last_message_sender_role === 'admin' && <span className="font-medium text-foreground">You: </span>}
                          {c.last_message}
                        </p>
                        {c.unread_count > 0 && (
                          <span className="shrink-0 px-1.5 py-0.5 bg-rose-500 text-white font-bold rounded-full text-[10px] min-w-[18px] text-center shadow-sm">
                            {c.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Pane: Selected Conversation */}
        <div className="flex-1 flex flex-col bg-background min-w-0">
          {selectedChat ? (
            <>
              {/* Header */}
              <div className="px-5 py-3 border-b bg-card/60 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                    {selectedChat.customer_name ? selectedChat.customer_name.substring(0, 2).toUpperCase() : 'CU'}
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      {selectedChat.customer_name}
                    </h2>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {selectedChat.customer_phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          {selectedChat.customer_phone}
                        </span>
                      )}
                      {selectedChat.customer_email && (
                        <span className="hidden sm:flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          {selectedChat.customer_email}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href={`/admin/customers/${selectedChat.customer_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 px-2.5 py-1.5 rounded-lg border hover:bg-muted transition-colors"
                  >
                    View Account
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              {/* Messages Body with Auto-Scroll to Bottom */}
              <div 
                ref={scrollContainerRef}
                className="flex-1 p-4 md:p-6 overflow-y-auto bg-muted/20 space-y-3"
              >
                {messagesLoading ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-xs gap-2">
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                    Loading conversation...
                  </div>
                ) : messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
                    No messages yet in this conversation.
                  </div>
                ) : (
                  messages.map((msg, index) => {
                    const isAdmin = msg.sender_role === 'admin';
                    const currentDate = new Date(msg.created_at);
                    const prevDate = index > 0 ? new Date(messages[index - 1].created_at) : null;
                    const showDateBadge = !prevDate || !isSameDay(currentDate, prevDate);

                    return (
                      <div key={msg.id} className="space-y-3">
                        {/* SMS / WhatsApp Centered Date Badge */}
                        {showDateBadge && (
                          <div className="flex justify-center my-4 select-none">
                            <div className="px-3.5 py-1 rounded-full bg-slate-200/90 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold shadow-xs border border-border/50 flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5 text-primary" />
                              <span>{formatChatDateBadge(currentDate)}</span>
                            </div>
                          </div>
                        )}

                        {/* Message Row with Delete ALWAYS ON THE LEFT of the bubble */}
                        <div className={`flex flex-col ${isAdmin ? 'items-end' : 'items-start'} my-1`}>
                          <div className="flex items-center gap-2 max-w-[85%] sm:max-w-[75%]">
                            {/* Delete Icon on the LEFT */}
                            <button
                              type="button"
                              onClick={() => handleDeleteMessage(msg.id)}
                              disabled={deletingId === msg.id}
                              className="p-1.5 text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 rounded-full transition-all shrink-0"
                              title="Delete message"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>

                            <div
                              className={`rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                                isAdmin
                                  ? 'bg-primary text-primary-foreground rounded-br-xs'
                                  : 'bg-card text-card-foreground border border-border/60 rounded-bl-xs'
                              }`}
                            >
                              {/* Blue Customer Name in Incoming Bubble */}
                              {!isAdmin && (
                                <div className="text-xs font-bold text-sky-600 dark:text-sky-400 mb-1">
                                  {selectedChat.customer_name || 'Customer'}
                                </div>
                              )}

                              <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.message}</p>
                              
                              {msg.attachment_url && (
                                <div className="mt-2">
                                  <AttachmentRenderer url={msg.attachment_url} />
                                </div>
                              )}

                              {/* Stamped Date & Time inside bubble */}
                              <div
                                className={`flex items-center justify-end gap-1.5 mt-1 text-[10px] select-none ${
                                  isAdmin ? 'text-primary-foreground/75' : 'text-muted-foreground'
                                }`}
                              >
                                <span>
                                  {isToday(currentDate) ? format(currentDate, 'h:mm a') : format(currentDate, 'MMM d, h:mm a')}
                                </span>
                                {isAdmin && (
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

              {/* Attachment Preview */}
              {attachment && (
                <div className="px-4 py-2 bg-muted/40 border-t flex items-center justify-between text-xs">
                  <span className="truncate max-w-xs font-medium text-foreground">📎 {attachment.name}</span>
                  <button
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
              <form onSubmit={handleSendMessage} className="p-3 bg-card border-t flex items-center gap-2">
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
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Reply to customer..."
                  className="flex-1 bg-muted/50 border border-input/60 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:bg-background transition-all"
                />

                <button
                  type="submit"
                  disabled={(!replyText.trim() && !attachment) || sending}
                  className="p-2.5 rounded-full bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity"
                  title="Send reply"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
              <Headphones className="w-12 h-12 text-muted-foreground/40 mb-3" />
              <h3 className="text-sm font-semibold text-foreground">Select a customer</h3>
              <p className="text-xs text-muted-foreground max-w-xs mt-1">
                Choose a customer conversation from the list to view their messages and respond.
              </p>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
