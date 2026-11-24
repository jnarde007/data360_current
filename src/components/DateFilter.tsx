import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon } from 'lucide-react';
import { format, startOfDay, subDays, addDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { serverNow } from '@/hooks/use-server-time';

export type DatePreset = 'all' | 'today' | 'yesterday' | 'custom';

interface DateFilterProps {
  datePreset: DatePreset;
  customDate: Date | undefined;
  onPresetChange: (preset: DatePreset) => void;
  onCustomDateChange: (date: Date | undefined) => void;
}

export function getDateRange(preset: DatePreset, customDate?: Date): { start: Date | null; end: Date | null } {
  const now = new Date(serverNow());
  switch (preset) {
    case 'today': {
      const start = startOfDay(now);
      const end = startOfDay(addDays(start, 1));
      return { start, end };
    }
    case 'yesterday': {
      const y = subDays(now, 1);
      return { start: startOfDay(y), end: startOfDay(now) };
    }
    case 'custom':
      if (customDate) {
        const s = startOfDay(customDate);
        const e = new Date(s);
        e.setDate(e.getDate() + 1);
        return { start: s, end: e };
      }
      return { start: null, end: null };
    default:
      return { start: null, end: null };
  }
}

function parseDateValue(value: string): Date | null {
  const direct = new Date(value);
  if (Number.isFinite(direct.getTime())) return direct;

  const normalized = value.includes(' ') ? value.replace(' ', 'T') : value;
  const fallback = new Date(normalized);
  return Number.isFinite(fallback.getTime()) ? fallback : null;
}

export function filterByDate<T>(items: T[], getDate: (item: T) => string, preset: DatePreset, customDate?: Date): T[] {
  const { start, end } = getDateRange(preset, customDate);
  if (!start || !end) return items;

  return items.filter(item => {
    const d = parseDateValue(getDate(item));
    return d ? d >= start && d < end : false;
  });
}

export function DateFilter({ datePreset, customDate, onPresetChange, onCustomDateChange }: DateFilterProps) {
  const [calendarOpen, setCalendarOpen] = useState(false);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button
        size="sm"
        variant={datePreset === 'all' ? 'default' : 'outline'}
        onClick={() => onPresetChange('all')}
        className="text-xs"
      >
        All Time
      </Button>
      <Button
        size="sm"
        variant={datePreset === 'today' ? 'default' : 'outline'}
        onClick={() => onPresetChange('today')}
        className="text-xs"
      >
        Today
      </Button>
      <Button
        size="sm"
        variant={datePreset === 'yesterday' ? 'default' : 'outline'}
        onClick={() => onPresetChange('yesterday')}
        className="text-xs"
      >
        Yesterday
      </Button>
      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant={datePreset === 'custom' ? 'default' : 'outline'}
            className={cn('text-xs gap-1.5', datePreset === 'custom' && customDate && 'min-w-[140px]')}
          >
            <CalendarIcon className="w-3.5 h-3.5" />
            {datePreset === 'custom' && customDate
              ? format(customDate, 'dd MMM yyyy')
              : 'Pick Date'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={customDate}
            onSelect={(d) => {
              onCustomDateChange(d);
              onPresetChange('custom');
              setCalendarOpen(false);
            }}
            disabled={(date) => date > new Date()}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
