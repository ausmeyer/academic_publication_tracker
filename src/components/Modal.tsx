import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]';
let openDialogs = 0;
// The app's banners are on the page behind an open dialog, out of reach of assistive technology,
// so a message raised meanwhile is also announced by the dialog.
let dialogMessage = '';
const listeners = new Set<() => void>();
export function announceInDialog(message: string) {
  dialogMessage = message;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
/** The page behind a dialog cannot be reached by keyboard, pointer or screen reader. */
function setBackgroundInert(inert: boolean) {
  const root = document.getElementById('root');
  if (!root) return;
  if (inert) {
    root.setAttribute('inert', '');
    root.setAttribute('aria-hidden', 'true');
  } else {
    root.removeAttribute('inert');
    root.removeAttribute('aria-hidden');
  }
}

export default function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
  dirty = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  /** Typed input that Escape or a click outside would discard: those ask first. */
  dirty?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // Read while rendering: React has not yet moved focus into the dialog, so this is the opener.
  const opener = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const beforeConfirm = useRef<HTMLElement | null>(null);
  const alive = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const [confirming, setConfirming] = useState(false);
  const message = useSyncExternalStore(subscribe, () => dialogMessage);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const confirmingRef = useRef(false);
  confirmingRef.current = confirming;
  const requestClose = useCallback(() => {
    if (confirmingRef.current) setConfirming(false);
    else if (dirtyRef.current) {
      beforeConfirm.current = document.activeElement as HTMLElement | null;
      setConfirming(true);
    } else closeRef.current();
  }, []);
  useEffect(() => {
    if (confirming) keepEditing.current?.focus();
    else if (beforeConfirm.current?.isConnected) beforeConfirm.current.focus();
  }, [confirming]);
  useEffect(() => {
    alive.current = true;
    openDialogs++;
    setBackgroundInert(true);
    const focusable = () =>
      [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
        (el) => el.offsetParent !== null,
      );
    const frame = requestAnimationFrame(() => {
      if (
        panel.current?.contains(document.activeElement) &&
        document.activeElement !== panel.current
      )
        return;
      (
        panel.current?.querySelector<HTMLElement>('input, select, textarea') ?? focusable()[0]
      )?.focus();
    });
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        requestClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        panel.current?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = Boolean(panel.current?.contains(active)) && active !== panel.current;
      if (!inside || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }
    function trap(event: FocusEvent) {
      const target = event.target as Node | null;
      if (target && panel.current && !panel.current.contains(target)) focusable()[0]?.focus();
      // A checkbox or radio button is drawn as its whole label: all of it comes into view, above
      // the sticky footer, not only the input.
      else if (target instanceof HTMLInputElement && ['checkbox', 'radio'].includes(target.type))
        target.closest('label')?.scrollIntoView({ block: 'nearest' });
    }
    document.addEventListener('keydown', key);
    document.addEventListener('focusin', trap);
    return () => {
      alive.current = false;
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', key);
      document.removeEventListener('focusin', trap);
      if (--openDialogs === 0) setBackgroundInert(false);
      // Development re-runs effects right away; only a real close hands focus back.
      queueMicrotask(() => {
        if (alive.current) return;
        const target = opener.current;
        // An opener disabled by the work the dialog started (New search) cannot take focus.
        (target && target !== document.body && target.isConnected && !target.matches(':disabled')
          ? target
          : document.querySelector<HTMLElement>('[data-focus-fallback]')
        )?.focus();
      });
    };
  }, [requestClose]);
  // Controls scrolled into view stop above the sticky footer at the height it has now (a message
  // in it, buttons on two rows); styles.css reads --modal-footer-height.
  useEffect(() => {
    const footer = panel.current?.querySelector<HTMLElement>('.modal-footer');
    if (!footer) return;
    const observer = new ResizeObserver(() =>
      panel.current?.style.setProperty('--modal-footer-height', `${footer.offsetHeight}px`),
    );
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={panel}
        className={`modal ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {message && (
          <p className="sr-only" role="alert">
            {message}
          </p>
        )}
        {confirming && (
          <div className="discard-confirm" role="alert">
            <p>Discard what you entered?</p>
            <div>
              <button
                ref={keepEditing}
                className="button secondary compact"
                onClick={() => setConfirming(false)}
              >
                Keep editing
              </button>
              <button className="button danger compact" onClick={onClose}>
                Discard changes
              </button>
            </div>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
