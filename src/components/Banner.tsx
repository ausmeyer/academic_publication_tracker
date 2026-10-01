import type { ReactNode } from 'react';
import { X } from 'lucide-react';

/** A message strip above the page content: errors announce themselves, notices wait politely. */
export default function Banner({
  title,
  tone = 'error',
  onDismiss,
  dismissLabel = 'Dismiss',
  children,
}: {
  title: string;
  tone?: 'error' | 'notice';
  onDismiss?: () => void;
  dismissLabel?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`error-banner ${tone === 'notice' ? 'notice' : ''}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <div>
        <strong>{title}</strong>
        {children}
      </div>
      {onDismiss && (
        <button className="icon-button" aria-label={dismissLabel} onClick={onDismiss}>
          <X size={17} />
        </button>
      )}
    </div>
  );
}
