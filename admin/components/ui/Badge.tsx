/**
 * Badge component for status indicators
 */

import { cn } from '@/lib/utils';
import type { BadgeVariant } from '@/types/tree';

interface BadgeProps {
  variant?: BadgeVariant | 'plan';
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<BadgeVariant | 'plan', string> = {
  default: 'bg-slate-100 text-slate-800',
  success: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-amber-100 text-amber-800',
  error: 'bg-rose-100 text-rose-800',
  info: 'bg-blue-100 text-blue-800',
  plan: 'bg-purple-100 text-purple-800',
};

export function Badge({ variant = 'default', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full',
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}

// Plan-specific badges
const planStyles: Record<string, string> = {
  FREE: 'bg-slate-100 text-slate-800',
  STARTER: 'bg-emerald-100 text-emerald-800',
  CORE: 'bg-amber-100 text-amber-800',
  PRO: 'bg-rose-100 text-rose-800',
  GROWTH: 'bg-indigo-100 text-indigo-800',
  SCALE: 'bg-purple-100 text-purple-800',
};

export function PlanBadge({ plan }: { plan: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full',
        planStyles[plan] || planStyles.FREE
      )}
    >
      {plan}
    </span>
  );
}

// Status badges for connections
const statusStyles: Record<string, { bg: string; dot?: string }> = {
  ACTIVE: { bg: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500' },
  PENDING_INVITE: { bg: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500' },
  PAUSED: { bg: 'bg-slate-100 text-slate-800', dot: 'bg-slate-400' },
  TERMINATED: { bg: 'bg-rose-100 text-rose-800', dot: 'bg-rose-500' },
};

export function StatusBadge({ status }: { status: string }) {
  const style = statusStyles[status] || statusStyles.ACTIVE;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-semibold rounded-full',
        style.bg
      )}
    >
      {style.dot && <span className={cn('w-1.5 h-1.5 rounded-full', style.dot)} />}
      {status.replace('_', ' ')}
    </span>
  );
}
