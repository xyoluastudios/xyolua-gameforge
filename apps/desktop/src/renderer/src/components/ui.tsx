import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import type { UserFacingError } from '@shared/api';

export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M4 9.5 16 3l12 6.5v13L16 29 4 22.5z"
        fill="none"
        stroke="#e8a33a"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path d="M10 13h12l-2.5 4H16v6h-3.5v-6H10z" fill="#e8a33a" />
    </svg>
  );
}

export function Spinner() {
  return <span className="spinner" role="status" aria-label="Working" />;
}

export function Modal({
  title,
  icon,
  onClose,
  children,
  footer,
  size,
  testId,
}: {
  title: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'small' | 'wide';
  testId?: string;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size ?? ''}`} role="dialog" aria-modal="true" data-testid={testId}>
        <div className="modal-header">
          {icon}
          <h2>{title}</h2>
          <span className="grow" />
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ErrorCallout({ error }: { error: UserFacingError }) {
  return (
    <div className="callout error" role="alert">
      <div>
        <div className="title">{error.message}</div>
        {error.reason && (
          <div>
            <span className="muted">Reason: </span>
            {error.reason}
          </div>
        )}
        {error.solution && (
          <div>
            <span className="muted">Solution: </span>
            {error.solution}
          </div>
        )}
      </div>
    </div>
  );
}

export function ScoreBar({ value }: { value: number }) {
  const color = value >= 75 ? 'var(--green)' : value >= 50 ? 'var(--yellow)' : 'var(--red)';
  return (
    <div className="bar">
      <div style={{ width: `${Math.max(2, Math.min(100, value))}%`, background: color }} />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

export function formatBytes(size?: number): string {
  if (size === undefined) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
