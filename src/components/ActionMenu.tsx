import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';

/** A disclosure menu that closes when an item is used, on Escape and on a click elsewhere. */
export default function ActionMenu({
  label,
  children,
}: {
  label: string;
  children: (close: () => void) => ReactNode;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!details.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      details.current?.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  // Focus goes back to the summary first, so a dialog opened by an item returns there when it closes.
  const close = () => {
    details.current?.querySelector('summary')?.focus();
    setOpen(false);
  };
  return (
    <details ref={details} className="action-menu" open={open}>
      <summary
        aria-label={label}
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
      >
        <MoreHorizontal size={20} />
      </summary>
      <div>{children(close)}</div>
    </details>
  );
}
