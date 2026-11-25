const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────
// 1. UPDATE ADMIN SUPPORT PAGE (src/pages/admin/AdminSupportPage.tsx)
// ─────────────────────────────────────────────────────────────
const adminPath = path.join(__dirname, 'src', 'pages', 'admin', 'AdminSupportPage.tsx');
let adminCode = fs.readFileSync(adminPath, 'utf8').replace(/\r\n/g, '\n');

// Ensure Bell is imported
if (!adminCode.includes('Bell,')) {
  adminCode = adminCode.replace(
    "import { Loader2, ArrowLeft, Send, LifeBuoy, Search, X, Paperclip, FileText, Image as ImageIcon, Hash, Layers, AlertTriangle, Tag, User } from 'lucide-react';",
    "import { Loader2, ArrowLeft, Send, LifeBuoy, Search, X, Paperclip, FileText, Image as ImageIcon, Hash, Layers, AlertTriangle, Tag, User, Bell } from 'lucide-react';"
  );
}

// Replace loud [Open] button with clean Notification Bell badge on the left ticket list
const adminStatusRegex = /(<p className="text-sm font-semibold text-foreground truncate">\{t\.subject\}<\/p>\s*)<StatusBadge status=\{t\.status\} \/>/;

const cleanBadgeReplacement = `$1{t.status === 'open' || t.status === 'pending' ? (
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
                          )}`;

if (adminStatusRegex.test(adminCode)) {
  adminCode = adminCode.replace(adminStatusRegex, cleanBadgeReplacement);
  fs.writeFileSync(adminPath, adminCode, 'utf8');
  console.log('SUCCESS: AdminSupportPage.tsx ticket list updated with Notification Bell badge.');
} else {
  console.log('NOTICE: Admin ticket list badge already updated.');
}

// ─────────────────────────────────────────────────────────────
// 2. UPDATE CUSTOMER SUPPORT PAGE (src/pages/SupportPage.tsx)
// ─────────────────────────────────────────────────────────────
const supportPath = path.join(__dirname, 'src', 'pages', 'SupportPage.tsx');
let supportCode = fs.readFileSync(supportPath, 'utf8').replace(/\r\n/g, '\n');

// Ensure Bell is imported
if (!supportCode.includes('Bell,')) {
  supportCode = supportCode.replace(
    "import { Loader2, Plus, ArrowLeft, Send, LifeBuoy, Paperclip, FileText, Image as ImageIcon, X, Tag, Hash, AlertTriangle, Layers, Search, MessageSquare } from 'lucide-react';",
    "import { Loader2, Plus, ArrowLeft, Send, LifeBuoy, Paperclip, FileText, Image as ImageIcon, X, Tag, Hash, AlertTriangle, Layers, Search, MessageSquare, Bell } from 'lucide-react';"
  );
}

// Replace loud [Open] button with clean Notification Bell badge on customer ticket list
const supportStatusRegex = /(<p className="text-sm font-semibold text-foreground truncate">\{t\.subject\}<\/p>\s*)<StatusBadge status=\{t\.status\} \/>/;

if (supportStatusRegex.test(supportCode)) {
  supportCode = supportCode.replace(supportStatusRegex, cleanBadgeReplacement);
}

// Replace threadView with the new messenger layout for the customer
const customerThreadRegex = /threadView = \(\s*<div className="space-y-5">[\s\S]*?(\{\/\* ── Reply Composer ── \*\/)/;

const newCustomerThread = `threadView = (
        <div className="space-y-4">
          {/* ── Compact Ticket Header Bar ── */}
          <div className="rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm p-3.5 sm:p-4 shadow-sm space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => { setSelectedTicket(null); setMessages([]); setRelatedOrderShortId(null); }}
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
                <StatusBadge status={selectedTicket.status} />
                {canReopen && (
                  <Button variant="outline" size="sm" onClick={reopenTicket} className="h-7 text-xs px-2.5">
                    Reopen
                  </Button>
                )}
              </div>
            </div>

            {/* Tags / Meta inline row */}
            <div className="flex items-center gap-2 flex-wrap text-xs pt-2 border-t border-border/40">
              <Badge variant="outline" className={\`text-[10px] capitalize \${priorityColors[selectedTicket.priority]}\`}>
                {selectedTicket.priority} Priority
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
            {/* Initial customer message (outgoing on right for customer) */}
            <div className="flex justify-end gap-2.5 items-end">
              <div className="max-w-[85%] sm:max-w-[72%] space-y-1">
                <div className="flex items-center justify-end gap-2 px-1">
                  <span className="text-[11px] font-medium text-muted-foreground">You</span>
                  <span className="text-[10px] text-muted-foreground/50">
                    {format(new Date(selectedTicket.created_at), 'dd MMM, h:mm a')}
                  </span>
                </div>
                <div className="rounded-2xl rounded-br-xs px-4 py-2.5 bg-blue-600 text-white shadow-sm">
                  <p className="text-[13px] whitespace-pre-wrap leading-relaxed">{selectedTicket.message}</p>
                </div>
              </div>
              <div className="shrink-0 w-7 h-7 rounded-full bg-blue-600/15 border border-blue-500/25 flex items-center justify-center shadow-sm">
                <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400">Y</span>
              </div>
            </div>

            {/* Replies Thread */}
            {messagesLoading ? (
              <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
            ) : messages.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-xs text-muted-foreground/50">Our support team has received your ticket and will respond soon.</p>
              </div>
            ) : (
              messages.map(m => {
                const isCustomer = m.sender_role === 'customer';
                const senderLabel = isCustomer ? 'You' : 'Support';
                const avatarLetter = isCustomer ? 'Y' : 'S';

                if (isCustomer) {
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
          </div>\n\n          $1`;

if (customerThreadRegex.test(supportCode)) {
  supportCode = supportCode.replace(customerThreadRegex, newCustomerThread);
  console.log('SUCCESS: SupportPage.tsx messenger chat layout updated.');
} else {
  console.log('NOTICE: Customer chat thread already updated or landmark not matched.');
}

fs.writeFileSync(supportPath, supportCode, 'utf8');
console.log('SUCCESS: Both Customer and Admin support pages cleaned up.');
