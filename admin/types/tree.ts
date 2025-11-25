/**
 * Tree node types for resource navigation
 */

import type { Shop, Connection, Product } from './domain';

export type TreeNodeType =
  | 'root'
  | 'all-shops'
  | 'shop'
  | 'connections-group'
  | 'products-group'
  | 'orders-group'
  | 'health-group'
  | 'connection'
  | 'product';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

export interface TreeBadge {
  text: string;
  variant: BadgeVariant;
}

export interface TreeNode {
  id: string;
  type: TreeNodeType;
  label: string;
  sublabel?: string;
  badge?: TreeBadge;
  children?: TreeNode[];
  // Associated data (if applicable)
  data?: Shop | Connection | Product;
  // UI state (managed by context)
  isExpanded?: boolean;
  isSelected?: boolean;
  isLoading?: boolean;
  // Depth for indentation
  depth: number;
}

// Helper type for building tree from flat data
export interface TreeBuilder {
  buildShopTree: (shops: Shop[], viewMode: 'retailers' | 'suppliers') => TreeNode[];
  buildConnectionsGroup: (shop: Shop, connections: Connection[]) => TreeNode;
  buildProductsGroup: (shop: Shop, products: Product[]) => TreeNode;
}

// Flattened node for rendering (includes expanded state)
export interface FlatTreeNode extends TreeNode {
  visible: boolean;
  parentId: string | null;
}
