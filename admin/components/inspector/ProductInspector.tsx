'use client';

/**
 * Product inspector panel
 */

import { Copy, Package, DollarSign, Boxes, Link } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/context/ToastContext';
import { formatCurrency, formatNumber, formatDate } from '@/lib/utils';
import type { Product } from '@/types/domain';

interface ProductInspectorProps {
  product: Product;
}

export function ProductInspector({ product }: ProductInspectorProps) {
  const { pushToast } = useToast();

  const copyId = () => {
    navigator.clipboard.writeText(product.id);
    pushToast('info', 'Product ID copied');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Badge variant={product.isWholesaleEligible ? 'success' : 'default'}>
            {product.isWholesaleEligible ? 'Wholesale Eligible' : 'Not Enabled'}
          </Badge>
        </div>
        <h3 className="text-lg font-semibold text-slate-900">{product.title}</h3>
        <p className="text-sm text-slate-500">
          {product.supplierShop.myshopifyDomain}
        </p>
        {product.createdAt && (
          <p className="text-xs text-slate-400 mt-1">
            Added {formatDate(product.createdAt)}
          </p>
        )}
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          icon={DollarSign}
          label="Wholesale Price"
          value={formatCurrency(product.wholesalePrice)}
        />
        <MetricCard
          icon={Boxes}
          label="Inventory"
          value={formatNumber(product.inventoryQuantity)}
          alert={product.inventoryQuantity < 10}
        />
        <MetricCard
          icon={Link}
          label="Mappings"
          value={String(product.mappingCount)}
        />
        <MetricCard
          icon={Package}
          label="SKU"
          value={product.sku || '—'}
          mono
        />
      </div>

      {/* Details */}
      <div className="space-y-3">
        <DetailRow label="SKU" value={product.sku || 'No SKU'} mono />
        <DetailRow
          label="Wholesale Price"
          value={formatCurrency(product.wholesalePrice)}
        />
        <DetailRow
          label="Inventory"
          value={`${formatNumber(product.inventoryQuantity)} units`}
        />
        <DetailRow
          label="Product Mappings"
          value={`${product.mappingCount} retailer${product.mappingCount !== 1 ? 's' : ''}`}
        />
        <DetailRow
          label="Supplier"
          value={product.supplierShop.myshopifyDomain}
        />
      </div>

      {/* Actions */}
      <div className="border-t pt-4 space-y-2">
        <p className="text-xs text-slate-500 font-medium mb-2">Actions</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={copyId}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg hover:bg-slate-50 transition"
          >
            <Copy className="w-3 h-3" />
            Copy ID
          </button>
        </div>
      </div>

      {/* IDs */}
      <div className="text-xs text-slate-500 space-y-1 border-t pt-4">
        <p>
          <span className="text-slate-400">Product ID:</span>{' '}
          <code className="font-mono bg-slate-100 px-1 rounded">{product.id}</code>
        </p>
      </div>
    </div>
  );
}

interface MetricCardProps {
  icon: typeof Package;
  label: string;
  value: string;
  alert?: boolean;
  mono?: boolean;
}

function MetricCard({ icon: Icon, label, value, alert, mono }: MetricCardProps) {
  return (
    <div className="border rounded-lg p-3 bg-white">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-xs text-slate-500">{label}</span>
      </div>
      <div
        className={`text-lg font-semibold ${
          alert ? 'text-amber-600' : 'text-slate-900'
        } ${mono ? 'font-mono text-sm' : ''}`}
      >
        {value}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-sm text-slate-900 ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  );
}
