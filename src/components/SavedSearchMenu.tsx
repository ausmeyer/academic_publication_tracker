import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen, Pencil, Trash2 } from 'lucide-react';

export default function SavedSearchMenu({
  name,
  x,
  y,
  onOpen,
  onRename,
  onDelete,
  onClose,
}: {
  name: string;
  x: number;
  y: number;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: (restoreFocus?: boolean) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const bounds = panel.current!.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8)),
    });
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [x, y]);
  useEffect(() => {
    const dismiss = () => close.current();
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) dismiss();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, []);
  return createPortal(
    <div
      ref={panel}
      className="saved-search-menu"
      role="menu"
      aria-label={`Actions for ${name}`}
      style={position}
      onKeyDown={(event) => {
        const items = [...panel.current!.querySelectorAll<HTMLButtonElement>('button')];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        } else if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault();
          event.stopPropagation();
          onClose(true);
        }
      }}
    >
      <div className="saved-search-menu-name">{name}</div>
      <button role="menuitem" onClick={onOpen}>
        <FolderOpen size={15} />
        Open search
      </button>
      <button role="menuitem" onClick={onRename}>
        <Pencil size={15} />
        Rename search
      </button>
      <button role="menuitem" className="danger-text" onClick={onDelete}>
        <Trash2 size={15} />
        Delete search
      </button>
    </div>,
    document.body,
  );
}
