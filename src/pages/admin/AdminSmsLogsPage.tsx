import { useState, useEffect, useCallback } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/Pagination';
import { MessageSquare, Search, RefreshCw, Eye, AlertTriangle, CheckCircle2, XCircle, SkipForward, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

const PAGE_SIZE = 25;

interface SmsLog {
  id: string;
  created_at: string;
  event_type: string;
  recipient_phone: string;
  status: string;
  message_body: string;
  error_message: string | null;
  provider_response: any;
  related_order_id: string | null;
  related_purchase_id: string | null;
  customer_id: string | null;
}

const statusConfig: Record<string, { className: string; icon: React.ReactNode; label: string }> = {
  sent: { className: 'bg-success/10 text-success border-success/20', icon: <CheckCircle2 className="w-3 h-3" />, label: 'Sent' },
  failed: { className: 'bg-destructive/10 text-destructive border-destructive/20', icon: <XCircle className="w-3 h-3" />, label: 'Failed' },
  skipped: { className: 'bg-warning/10 text-warning border-warning/20', icon: <SkipForward className="w-3 h-3" />, label: 'Skipped' },
  pending: { className: 'bg-info/10 text-info border-info/20', icon: <Clock className="w-3 h-3" />, label: 'Pending' },
};

function SmsStatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] || { className: 'bg-muted text-muted-foreground border-border', icon: null, label: status };
  return (
    <Badge variant="outline" className={`text-[10px] font-medium gap-1 px-2 py-0.5 ${cfg.className}`}>
      {cfg.icon}
      {cfg.label}
    </Badge>
  );
}

export default function AdminSmsLogsPage() {
  const { toast } = useToast();
  const [logs, setLogs] = useState<SmsLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedLog, setSelectedLog] = useState<SmsLog | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [eventFilter, setEventFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('sms_send_log')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      if (eventFilter !== 'all') query = query.eq('event_type', eventFilter);
      if (searchQuery) {
        query = query.or(`recipient_phone.ilike.%${searchQuery}%,related_order_id.eq.${searchQuery},related_purchase_id.eq.${searchQuery},message_body.ilike.%${searchQuery}%`);
      }

      const from = (page - 1) * PAGE_SIZE;
      query = query.range(from, from + PAGE_SIZE - 1);

      const { data, count, error } = await query;
      if (error) throw error;
      setLogs((data as SmsLog[]) || []);
      setTotalCount(count || 0);
    } catch (err: any) {
      toast({ title: 'Error loading SMS logs', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, eventFilter, searchQuery, toast]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const handleSearch = () => {
    setSearchQuery(searchInput.trim());
    setPage(1);
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Stats
  const sentCount = logs.filter(l => l.status === 'sent').length;
  const failedCount = logs.filter(l => l.status === 'failed').length;
  const skippedCount = logs.filter(l => l.status === 'skipped').length;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <MessageSquare className="w-6 h-6 text-primary" />
              SMS Logs
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Monitor all SMS activity, delivery statuses, and provider responses
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="border-border">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted"><MessageSquare className="w-4 h-4 text-muted-foreground" /></div>
              <div><p className="text-xs text-muted-foreground">Total (page)</p><p className="text-lg font-bold text-foreground">{totalCount}</p></div>
            </CardContent>
          </Card>
          <Card className="border-success/20">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10"><CheckCircle2 className="w-4 h-4 text-success" /></div>
              <div><p className="text-xs text-muted-foreground">Sent</p><p className="text-lg font-bold text-success">{sentCount}</p></div>
            </CardContent>
          </Card>
          <Card className="border-destructive/20">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10"><XCircle className="w-4 h-4 text-destructive" /></div>
              <div><p className="text-xs text-muted-foreground">Failed</p><p className="text-lg font-bold text-destructive">{failedCount}</p></div>
            </CardContent>
          </Card>
          <Card className="border-warning/20">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-warning/10"><SkipForward className="w-4 h-4 text-warning" /></div>
              <div><p className="text-xs text-muted-foreground">Skipped</p><p className="text-lg font-bold text-warning">{skippedCount}</p></div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 flex gap-2">
                <Input
                  placeholder="Search phone, order ID, message..."
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  className="flex-1"
                />
                <Button variant="outline" size="icon" onClick={handleSearch}>
                  <Search className="w-4 h-4" />
                </Button>
              </div>
              <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="skipped">Skipped</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
              <Select value={eventFilter} onValueChange={v => { setEventFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[180px]"><SelectValue placeholder="Event Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Events</SelectItem>
                  <SelectItem value="order_delivered">Order Delivered</SelectItem>
                  <SelectItem value="guest_payment_confirmed">Guest Payment</SelectItem>
                  <SelectItem value="checker_code">Checker Code</SelectItem>
                  <SelectItem value="refund_success">Refund</SelectItem>
                  <SelectItem value="admin_topup">Admin Top-up</SelectItem>
                  <SelectItem value="account_creation">Account Created</SelectItem>
                  <SelectItem value="test">Test</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[150px]">Time</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Message</TableHead>
                    <TableHead className="hidden md:table-cell">Related</TableHead>
                    <TableHead className="w-[60px]">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                        Loading...
                      </TableCell>
                    </TableRow>
                  ) : logs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                        No SMS logs found
                      </TableCell>
                    </TableRow>
                  ) : (
                    logs.map(log => (
                      <TableRow
                        key={log.id}
                        className={log.status === 'failed' ? 'bg-destructive/5' : log.status === 'skipped' ? 'bg-warning/5' : ''}
                      >
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(log.created_at), 'MMM d, HH:mm:ss')}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-[10px] font-mono">
                            {log.event_type || 'unknown'}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{log.recipient_phone}</TableCell>
                        <TableCell><SmsStatusBadge status={log.status} /></TableCell>
                        <TableCell className="hidden lg:table-cell max-w-[200px]">
                          <span className="text-xs text-muted-foreground truncate block">
                            {log.message_body?.substring(0, 60)}{log.message_body?.length > 60 ? '...' : ''}
                          </span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs">
                          {log.related_order_id && (
                            <span className="text-primary font-mono block">Order: {log.related_order_id.substring(0, 8)}...</span>
                          )}
                          {log.related_purchase_id && (
                            <span className="text-primary font-mono block">Purchase: {log.related_purchase_id.substring(0, 8)}...</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedLog(log)}>
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {totalPages > 1 && (
              <div className="p-4 border-t border-border">
                <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={open => !open && setSelectedLog(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              SMS Detail
              {selectedLog && <SmsStatusBadge status={selectedLog.status} />}
            </DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Time</label>
                  <p className="font-medium">{format(new Date(selectedLog.created_at), 'MMM d, yyyy HH:mm:ss')}</p>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Event Type</label>
                  <p className="font-mono">{selectedLog.event_type}</p>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Recipient</label>
                  <p className="font-mono">{selectedLog.recipient_phone}</p>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Status</label>
                  <p><SmsStatusBadge status={selectedLog.status} /></p>
                </div>
              </div>

              {selectedLog.related_order_id && (
                <div>
                  <label className="text-xs text-muted-foreground">Related Order</label>
                  <p className="font-mono text-primary">{selectedLog.related_order_id}</p>
                </div>
              )}

              {selectedLog.related_purchase_id && (
                <div>
                  <label className="text-xs text-muted-foreground">Related Purchase</label>
                  <p className="font-mono text-primary">{selectedLog.related_purchase_id}</p>
                </div>
              )}

              {selectedLog.customer_id && (
                <div>
                  <label className="text-xs text-muted-foreground">Customer ID</label>
                  <p className="font-mono">{selectedLog.customer_id}</p>
                </div>
              )}

              <div>
                <label className="text-xs text-muted-foreground">Message Body</label>
                <pre className="mt-1 p-3 bg-muted rounded-lg text-xs whitespace-pre-wrap font-mono border border-border">
                  {selectedLog.message_body}
                </pre>
              </div>

              {(selectedLog.status === 'failed' || selectedLog.status === 'skipped') && selectedLog.error_message && (
                <div>
                  <label className="text-xs text-destructive font-medium flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Error / Reason
                  </label>
                  <pre className="mt-1 p-3 bg-destructive/10 rounded-lg text-xs whitespace-pre-wrap font-mono border border-destructive/20 text-destructive">
                    {selectedLog.error_message}
                  </pre>
                </div>
              )}

              <div>
                <label className="text-xs text-muted-foreground">Provider Response</label>
                <pre className="mt-1 p-3 bg-muted rounded-lg text-xs whitespace-pre-wrap font-mono border border-border max-h-[200px] overflow-y-auto">
                  {JSON.stringify(selectedLog.provider_response, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
