import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';

export interface PaletteItem { to: string; label: string; icon: React.ElementType; description: string }
export interface PaletteGroup { label: string; items: PaletteItem[] }

export function AdminCommandPalette({
  open, onOpenChange, groups,
}: { open: boolean; onOpenChange: (o: boolean) => void; groups: PaletteGroup[] }) {
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Jump to an admin page…" />
      <CommandList>
        <CommandEmpty>No matching page.</CommandEmpty>
        {groups.map(g => (
          <CommandGroup key={g.label} heading={g.label}>
            {g.items.map(item => (
              <CommandItem
                key={item.to}
                value={`${item.label} ${item.description} ${g.label}`}
                onSelect={() => { onOpenChange(false); navigate(item.to); }}
                className="gap-3"
              >
                <item.icon className="w-4 h-4 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{item.description}</p>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
