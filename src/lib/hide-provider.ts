// Customer-facing text must never reveal upstream provider names.
const PROVIDER_RE = /\b(portal[\s-]?0?2|portal02|i[\s-]?get|datamart|provider)\b/gi;

export function hideProvider(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(PROVIDER_RE, (m) => (/provider/i.test(m) ? 'network' : 'Network'))
    .replace(/\bNetwork confirmed refund\b/i, 'Refund confirmed')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
