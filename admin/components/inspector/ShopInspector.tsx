'use client';

/**
 * Shop inspector panel
 */

import { useState } from 'react';
import { CreditCard, ArrowRightLeft, Package, ShoppingCart, RefreshCcw } from 'lucide-react';
import { PlanBadge, Badge } from '@/components/ui/Badge';
import { useToast } from '@/context/ToastContext';
import { formatDate, formatNumber, cn } from '@/lib/utils';
import type { Shop, ShopPlan } from '@/types/domain';

interface ShopInspectorProps {
  shop: Shop;
  onUpdatePlan?: (shopId: string, plan: string) => void;
}

const PLANS: ShopPlan[] = ['FREE', 'STARTER', 'CORE', 'PRO', 'GROWTH', 'SCALE'];

export function ShopInspector({ shop, onUpdatePlan }: ShopInspectorProps) {
  const { pushToast } = useToast();
  const [selectedPlan, setSelectedPlan] = useState(shop.plan);
  const [isUpdating, setIsUpdating] = useState(false);

  const handleUpdatePlan = async () => {
    if (!onUpdatePlan || selectedPlan === shop.plan) return;

    setIsUpdating(true);
    try {
      await onUpdatePlan(shop.id, selectedPlan);
      pushToast('success', `Plan updated to ${selectedPlan}`);
    } catch {
      pushToast('error', 'Failed to update plan');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-lg font-semibold text-slate-900">
            {shop.companyName || shop.myshopifyDomain}
          </h3>
          <PlanBadge plan={shop.plan} />
        </div>
        <p className="text-sm text-slate-500">{shop.myshopifyDomain}</p>
        <div className="flex items-center gap-2 mt-2">
          <Badge variant="default">{shop.role}</Badge>
          <span className="text-xs text-slate-400">
            Created {formatDate(shop.createdAt)}
          </span>
        </div>
      </div>

      {/* Usage Meters */}
      <div className="grid grid-cols-3 gap-3">
        <UsageMeter
          icon={ArrowRightLeft}
          label="Connections"
          value={shop.connectionCount}
          // TODO: Add limit from plan
        />
        <UsageMeter
          icon={Package}
          label="Products"
          value={shop.productCount}
        />
        <UsageMeter
          icon={ShoppingCart}
          label="Orders/mo"
          value={shop.purchaseOrdersThisMonth}
        />
      </div>

      {/* Plan Management */}
      <div className="border rounded-lg p-4 bg-slate-50/50">
        <div className="flex items-center gap-2 mb-3">
          <CreditCard className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-medium text-slate-700">Plan Management</span>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Current Plan</label>
            <div className="flex items-center gap-2">
              <PlanBadge plan={shop.plan} />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-500 block mb-1">Change Plan</label>
            <select
              value={selectedPlan}
              onChange={(e) => setSelectedPlan(e.target.value as ShopPlan)}
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {PLANS.map((plan) => (
                <option key={plan} value={plan}>
                  {plan}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleUpdatePlan}
            disabled={isUpdating || selectedPlan === shop.plan}
            className={cn(
              'w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-lg transition',
              selectedPlan !== shop.plan
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            )}
          >
            {isUpdating ? (
              <>
                <RefreshCcw className="w-4 h-4 animate-spin" />
                Updating...
              </>
            ) : (
              <>
                <CreditCard className="w-4 h-4" />
                Apply Plan Change
              </>
            )}
          </button>
        </div>
      </div>

      {/* Quick Info */}
      <div className="text-xs text-slate-500 space-y-1">
        <p>
          <span className="text-slate-400">Shop ID:</span>{' '}
          <code className="font-mono bg-slate-100 px-1 rounded">{shop.id}</code>
        </p>
      </div>
    </div>
  );
}

interface UsageMeterProps {
  icon: typeof ArrowRightLeft;
  label: string;
  value: number;
  limit?: number;
}

function UsageMeter({ icon: Icon, label, value, limit }: UsageMeterProps) {
  const percentage = limit ? Math.min((value / limit) * 100, 100) : 0;
  const isNearLimit = limit && percentage >= 80;

  return (
    <div className="border rounded-lg p-3 bg-white">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-xs text-slate-500">{label}</span>
      </div>
      <div className="text-lg font-semibold text-slate-900">
        {formatNumber(value)}
        {limit && (
          <span className="text-sm font-normal text-slate-400">
            /{formatNumber(limit)}
          </span>
        )}
      </div>
      {limit && (
        <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              isNearLimit ? 'bg-amber-500' : 'bg-blue-500'
            )}
            style={{ width: `${percentage}%` }}
          />
        </div>
      )}
    </div>
  );
}
