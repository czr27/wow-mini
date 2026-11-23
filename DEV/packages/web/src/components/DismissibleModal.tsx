import React, { useEffect } from 'react';

export type DismissibleModalProps = {
  /** When false, renders nothing. Omit / true when parent already gates with `&&`. */
  open?: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Extra classes on the full-screen backdrop (centering included). */
  overlayClassName?: string;
  /** Extra classes on the dialog panel. */
  panelClassName?: string;
  /** Close when Escape is pressed. Default true. */
  closeOnEscape?: boolean;
  /** Close when clicking the dimmed backdrop. Default true. */
  closeOnBackdrop?: boolean;
  /** z-index utility, e.g. `z-50` / `z-[60]`. Default `z-50`. */
  zClassName?: string;
  role?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
};

const DEFAULT_OVERLAY =
  'fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 select-none';
const DEFAULT_PANEL = 'relative outline-none';

/**
 * Shared dismissible dialog shell: ESC + click outside blank area to close.
 * Use for skill book, room create/settings, settlement certificates, etc.
 */
export const DismissibleModal: React.FC<DismissibleModalProps> = ({
  open = true,
  onClose,
  children,
  overlayClassName = '',
  panelClassName = '',
  closeOnEscape = true,
  closeOnBackdrop = true,
  zClassName = 'z-50',
  role = 'dialog',
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}) => {
  useEffect(() => {
    if (!open || !closeOnEscape) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, closeOnEscape, onClose]);

  if (!open) return null;

  return (
    <div
      className={`${DEFAULT_OVERLAY} ${zClassName} ${overlayClassName}`.trim()}
      onClick={closeOnBackdrop ? onClose : undefined}
      role="presentation"
    >
      <div
        className={`${DEFAULT_PANEL} ${panelClassName}`.trim()}
        role={role}
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
};
