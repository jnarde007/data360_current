import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Download, Loader2, Mail, MessageSquare, List, FileSpreadsheet, Settings2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import ExcelJS from 'exceljs';

// ── Field definitions ──

interface ExportField {
  key: string;
  label: string;
  group: 'basic' | 'financial' | 'referral' | 'activity';
}

const EXPORT_FIELDS: ExportField[] = [
  { key: 'full_name', label: 'Full Name', group: 'basic' },
  { key: 'email', label: 'Email', group: 'basic' },
  { key: 'phone', label: 'Phone Number', group: 'basic' },
  { key: 'id', label: 'Customer ID', group: 'basic' },
  { key: 'username', label: 'Username', group: 'basic' },
  { key: 'status', label: 'Status', group: 'basic' },
  { key: 'created_at', label: 'Date Joined', group: 'activity' },
  { key: 'wallet_balance', label: 'Wallet Balance', group: 'financial' },
  { key: 'total_orders', label: 'Total Orders', group: 'financial' },
  { key: 'total_spend', label: 'Total Spend', group: 'financial' },
  { key: 'affiliate_code', label: 'Referral Code', group: 'referral' },
  { key: 'referred_by', label: 'Referred By', group: 'referral' },
  { key: 'tags', label: 'Tags', group: 'activity' },
];

// ── Presets ──

type PresetKey = 'bulk_email' | 'bulk_sms' | 'basic_list' | 'full_export' | 'custom';

interface Preset {
  label: string;
  icon: React.ReactNode;
  description: string;
  fields: string[];
}

const PRESETS: Record<PresetKey, Preset> = {
  bulk_email: {
    label: 'Bulk Email',
    icon: <Mail className="w-3.5 h-3.5" />,
    description: 'Name, Email, Status',
    fields: ['full_name', 'email', 'status'],
  },
  bulk_sms: {
    label: 'Bulk SMS',
    icon: <MessageSquare className="w-3.5 h-3.5" />,
    description: 'Name, Phone, Status',
    fields: ['full_name', 'phone', 'status'],
  },
  basic_list: {
    label: 'Basic List',
    icon: <List className="w-3.5 h-3.5" />,
    description: 'Name, Email, Phone, Status, Date Joined',
    fields: ['full_name', 'email', 'phone', 'status', 'created_at'],
  },
  full_export: {
    label: 'Full Export',
    icon: <FileSpreadsheet className="w-3.5 h-3.5" />,
    description: 'All available fields',
    fields: EXPORT_FIELDS.map(f => f.key),
  },
  custom: {
    label: 'Custom',
    icon: <Settings2 className="w-3.5 h-3.5" />,
    description: 'Select fields manually',
    fields: [],
  },
};

// ── Component ──

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CustomerExportDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const [preset, setPreset] = useState<PresetKey>('bulk_email');
  const [customFields, setCustomFields] = useState<string[]>(PRESETS.bulk_email.fields);
  const [statusFilter, setStatusFilter] = useState('all');
  const [extraFilter, setExtraFilter] = useState('none');
  const [exporting, setExporting] = useState(false);

  const selectedFields = preset === 'custom' ? customFields : PRESETS[preset].fields;

  const toggleField = (key: string) => {
    setCustomFields(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const handlePresetChange = (key: PresetKey) => {
    setPreset(key);
    if (key !== 'custom') {
      setCustomFields(PRESETS[key].fields);
    }
  };

  const fieldsByGroup = useMemo(() => {
    const groups: Record<string, ExportField[]> = {};
    EXPORT_FIELDS.forEach(f => {
      if (!groups[f.group]) groups[f.group] = [];
      groups[f.group].push(f);
    });
    return groups;
  }, []);

  const groupLabels: Record<string, string> = {
    basic: 'Basic Info',
    financial: 'Financial',
    referral: 'Referral',
    activity: 'Activity',
  };

  const handleExport = async () => {
    if (selectedFields.length === 0) {
      toast({ title: 'No fields selected', description: 'Please select at least one field to export.', variant: 'destructive' });
      return;
    }

    setExporting(true);
    try {
      // Fetch customers
      let query = supabase
        .from('customers')
        .select('id, full_name, email, phone, username, wallet_balance, status, affiliate_code, referred_by, created_at')
        .neq('status', 'deleted')
        .order('created_at', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data: customers, error: custErr } = await query;
      if (custErr) throw custErr;
      if (!customers || customers.length === 0) {
        toast({ title: 'No customers found', description: 'No customers match the selected filters.', variant: 'destructive' });
        setExporting(false);
        return;
      }

      // Apply extra filters
      let filtered = customers;
      if (extraFilter === 'has_email') filtered = filtered.filter(c => c.email && c.email.trim());
      if (extraFilter === 'has_phone') filtered = filtered.filter(c => c.phone && c.phone.trim());
      if (extraFilter === 'has_balance') filtered = filtered.filter(c => Number(c.wallet_balance) > 0);

      if (filtered.length === 0) {
        toast({ title: 'No customers found', description: 'No customers match the selected filters.', variant: 'destructive' });
        setExporting(false);
        return;
      }

      // Fetch orders aggregate if needed
      let orderMap: Record<string, { count: number; spend: number }> = {};
      if (selectedFields.includes('total_orders') || selectedFields.includes('total_spend')) {
        const { data: orders } = await supabase
          .from('orders')
          .select('customer_id, total_amount, status')
          .eq('status', 'delivered');
        if (orders) {
          orders.forEach((o: any) => {
            if (!o.customer_id) return;
            if (!orderMap[o.customer_id]) orderMap[o.customer_id] = { count: 0, spend: 0 };
            orderMap[o.customer_id].count++;
            orderMap[o.customer_id].spend += Number(o.total_amount);
          });
        }
      }

      // Fetch tags if needed
      let tagMap: Record<string, string[]> = {};
      if (selectedFields.includes('tags')) {
        const { data: tags } = await supabase.from('customer_tags').select('customer_id, tag');
        if (tags) {
          tags.forEach((t: any) => {
            if (!tagMap[t.customer_id]) tagMap[t.customer_id] = [];
            tagMap[t.customer_id].push(t.tag);
          });
        }
      }

      // Build Excel
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Data360';
      wb.created = new Date();
      const ws = wb.addWorksheet('Customers');

      const fieldDefs = EXPORT_FIELDS.filter(f => selectedFields.includes(f.key));

      // Headers
      const headerRow = ws.addRow(fieldDefs.map(f => f.label));
      headerRow.eachCell(cell => {
        cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
        cell.alignment = { vertical: 'middle' };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFD0D5DD' } } };
      });

      // Data rows
      filtered.forEach(c => {
        const row = fieldDefs.map(f => {
          switch (f.key) {
            case 'full_name': return c.full_name;
            case 'email': return c.email;
            case 'phone': return c.phone;
            case 'id': return c.id;
            case 'username': return c.username || '';
            case 'status': return c.status;
            case 'created_at': return c.created_at ? new Date(c.created_at) : '';
            case 'wallet_balance': return Number(c.wallet_balance);
            case 'total_orders': return orderMap[c.id]?.count || 0;
            case 'total_spend': return orderMap[c.id]?.spend || 0;
            case 'affiliate_code': return c.affiliate_code || '';
            case 'referred_by': return c.referred_by || '';
            case 'tags': return (tagMap[c.id] || []).join(', ');
            default: return '';
          }
        });
        const dataRow = ws.addRow(row);
        dataRow.eachCell((cell, colNumber) => {
          cell.font = { size: 10 };
          const fieldKey = fieldDefs[colNumber - 1]?.key;
          if (fieldKey === 'created_at' && cell.value instanceof Date) {
            cell.numFmt = 'DD MMM YYYY';
          }
          if (fieldKey === 'wallet_balance' || fieldKey === 'total_spend') {
            cell.numFmt = '#,##0.00';
          }
        });
      });

      // Auto-width
      fieldDefs.forEach((_, i) => {
        const col = ws.getColumn(i + 1);
        col.width = Math.max(14, fieldDefs[i].label.length + 4);
      });

      ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 0 }];

      // Write and download
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const presetLabel = PRESETS[preset].label.toLowerCase().replace(/\s+/g, '-');
      a.download = `customers-${presetLabel}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);

      // Log the export
      try {
        await supabase.from('admin_activity_logs').insert({
          admin_id: (await supabase.auth.getUser()).data.user?.id || '',
          action: 'customer_export',
          target_type: 'customers',
          details: {
            preset,
            fields: selectedFields,
            status_filter: statusFilter,
            extra_filter: extraFilter,
            customer_count: filtered.length,
            exported_at: new Date().toISOString(),
          },
        });
      } catch { /* non-critical */ }

      toast({ title: 'Export complete', description: `Exported ${filtered.length} customers.`, variant: 'success' });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Export failed', description: err?.message || 'Could not export customers.', variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="w-5 h-5 text-primary" />
            Export Customers
          </DialogTitle>
          <DialogDescription>Choose a preset or select fields manually</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Presets */}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Preset</Label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(PRESETS) as PresetKey[]).map(key => (
                <button
                  key={key}
                  onClick={() => handlePresetChange(key)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                    preset === key
                      ? 'bg-primary/15 border-primary/40 text-primary'
                      : 'bg-transparent border-border text-muted-foreground hover:border-primary/30 hover:text-foreground'
                  }`}
                >
                  {PRESETS[key].icon}
                  {PRESETS[key].label}
                </button>
              ))}
            </div>
            {preset !== 'custom' && (
              <p className="text-[11px] text-muted-foreground mt-1.5">{PRESETS[preset].description}</p>
            )}
          </div>

          {/* Field selection - always visible for custom, collapsible for presets */}
          {preset === 'custom' && (
            <div className="space-y-3">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Select Fields</Label>
              {Object.entries(fieldsByGroup).map(([group, fields]) => (
                <div key={group}>
                  <p className="text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider mb-1.5">{groupLabels[group]}</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    {fields.map(f => (
                      <label key={f.key} className="flex items-center gap-2 cursor-pointer text-sm py-0.5">
                        <Checkbox
                          checked={customFields.includes(f.key)}
                          onCheckedChange={() => toggleField(f.key)}
                        />
                        <span className="text-foreground">{f.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Filters */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Filters</Label>
            <div className="flex flex-col sm:flex-row gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="active">Active Only</SelectItem>
                  <SelectItem value="suspended">Suspended Only</SelectItem>
                  <SelectItem value="pending">Pending Only</SelectItem>
                </SelectContent>
              </Select>
              <Select value={extraFilter} onValueChange={setExtraFilter}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Extra filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Extra Filter</SelectItem>
                  <SelectItem value="has_email">Has Email</SelectItem>
                  <SelectItem value="has_phone">Has Phone</SelectItem>
                  <SelectItem value="has_balance">Has Wallet Balance</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Selected fields summary */}
          <div className="rounded-lg bg-muted/40 border border-border/60 px-3 py-2">
            <p className="text-[11px] text-muted-foreground mb-1">Fields to export:</p>
            <div className="flex flex-wrap gap-1">
              {selectedFields.length === 0 ? (
                <span className="text-xs text-muted-foreground italic">None selected</span>
              ) : (
                selectedFields.map(key => {
                  const f = EXPORT_FIELDS.find(ef => ef.key === key);
                  return <Badge key={key} variant="secondary" className="text-[10px] px-1.5 py-0">{f?.label || key}</Badge>;
                })
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleExport} disabled={exporting || selectedFields.length === 0}>
            {exporting ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Download className="w-4 h-4 mr-1.5" />}
            Export {selectedFields.length > 0 ? `(${selectedFields.length} fields)` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
