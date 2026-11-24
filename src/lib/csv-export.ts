// Minimal CSV export helper used by store dashboards.

function esc(v: any): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCSV<T extends Record<string, any>>(rows: T[], columns: { key: keyof T | string; label: string }[]): string {
  const header = columns.map(c => esc(c.label)).join(',');
  const lines = rows.map(r => columns.map(c => esc((r as any)[c.key])).join(','));
  return [header, ...lines].join('\n');
}

export function downloadCSV(filename: string, csv: string) {
  const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportRowsToCSV<T extends Record<string, any>>(
  filename: string,
  rows: T[],
  columns: { key: keyof T | string; label: string }[],
) {
  downloadCSV(filename, toCSV(rows, columns));
}

export function csvTimestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
