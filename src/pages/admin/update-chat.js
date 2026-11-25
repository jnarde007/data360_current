const fs = require('fs');
const path = require('path');

// 1. UPDATE CUSTOMER SUPPORT PAGE (src/pages/SupportPage.tsx)
const supportPath = path.join(__dirname, 'src', 'pages', 'SupportPage.tsx');
let supportCode = fs.readFileSync(supportPath, 'utf8');

const s1_start = '        <div className="space-y-5">\n          {/* Back button */}';
const s1_end = '          {/* ── Reply Composer ── */}';

const newSupportThread = `        <div className="space-y-4">
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
          </div>\n\n`;

const idx1_start = supportCode.indexOf(s1_start);
const idx1_end = supportCode.indexOf(s1_end);

if (idx1_start !== -1 && idx1_end !== -1) {
  supportCode = supportCode.slice(0, idx1_start) + newSupportThread + supportCode.slice(idx1_end);
  fs.writeFileSync(supportPath, supportCode, 'utf8');
  console.log('SUCCESS: src/pages/SupportPage.tsx updated with messenger layout.');
} else {
  console.error('ERROR: Could not find landmark in SupportPage.tsx');
}

// 2. UPDATE ADMIN SUPPORT PAGE (src/pages/admin/AdminSupportPage.tsx)
const adminPath = path.join(__dirname, 'src', 'pages', 'admin', 'AdminSupportPage.tsx');
let adminCode = fs.readFileSync(adminPath, 'utf8');

const s2_start = '        <div className="space-y-5">\n          <Button variant="ghost" size="sm" onClick={() => { setSelectedTicket(null); setRelatedOrderShortId(null); setAttachment(null); }} className="gap-1.5 lg:hidden">';
const s2_end = '          {/* ── Reply Composer ── */}';

const newAdminThread = `        <div className="space-y-4">
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

              <Badge variant="outline" className={\`text-[10px] capitalize \${priorityColors[selectedTicket.priority]}\`}>
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
          </div>\n\n`;

const idx2_start = adminCode.indexOf(s2_start);
const idx2_end = adminCode.indexOf(s2_end);

if (idx2_start !== -1 && idx2_end !== -1) {
  adminCode = adminCode.slice(0, idx2_start) + newAdminThread + adminCode.slice(idx2_end);
  fs.writeFileSync(adminPath, adminCode, 'utf8');
  console.log('SUCCESS: src/pages/admin/AdminSupportPage.tsx updated with messenger layout.');
} else {
  console.error('ERROR: Could not find landmark in AdminSupportPage.tsx');
}
