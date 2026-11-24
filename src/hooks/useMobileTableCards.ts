import { useEffect, type RefObject } from 'react';

/**
 * Labels every table cell inside the container with its column header
 * (data-label) so CSS in index.css can render rows as cards on phones.
 */
export function useMobileTableCards(ref: RefObject<HTMLElement>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let frame = 0;

    const label = () => {
      frame = 0;
      root.querySelectorAll('table').forEach((table) => {
        const headers = Array.from(table.querySelectorAll('thead tr:last-child th')).map(
          (th) => (th.textContent || '').trim(),
        );
        table.querySelectorAll('tbody tr').forEach((tr) => {
          let col = 0;
          Array.from(tr.children).forEach((cell) => {
            const el = cell as HTMLTableCellElement;
            const text = headers[col] || '';
            if (el.getAttribute('data-label') !== text) el.setAttribute('data-label', text);
            col += el.colSpan || 1;
          });
        });
      });
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(label);
    };
    label();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);
}
