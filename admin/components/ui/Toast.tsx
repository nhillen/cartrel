'use client';

/**
 * Toast notification components
 */

import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useToast, type Toast as ToastType, type ToastType as ToastVariant } from '@/context/ToastContext';
import { cn } from '@/lib/utils';

const toastStyles: Record<ToastVariant, { bg: string; icon: typeof CheckCircle }> = {
  success: {
    bg: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    icon: CheckCircle,
  },
  error: {
    bg: 'bg-rose-50 border-rose-200 text-rose-800',
    icon: AlertCircle,
  },
  warning: {
    bg: 'bg-amber-50 border-amber-200 text-amber-800',
    icon: AlertTriangle,
  },
  info: {
    bg: 'bg-blue-50 border-blue-200 text-blue-800',
    icon: Info,
  },
};

function Toast({ toast, onDismiss }: { toast: ToastType; onDismiss: () => void }) {
  const style = toastStyles[toast.type];
  const Icon = style.icon;

  return (
    <div
      className={cn(
        'px-4 py-3 rounded-lg shadow-md border text-sm flex items-center gap-2 animate-in slide-in-from-right',
        style.bg
      )}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1">{toast.message}</span>
      <button
        onClick={onDismiss}
        className="p-1 rounded hover:bg-black/5 transition"
        aria-label="Dismiss"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts, dismissToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 space-y-2 z-50 max-w-sm">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          toast={toast}
          onDismiss={() => dismissToast(toast.id)}
        />
      ))}
    </div>
  );
}
