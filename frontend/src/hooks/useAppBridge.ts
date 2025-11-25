/**
 * Hook to access the App Bridge v4 shopify global
 * For backwards compatibility - prefer using window.shopify directly
 */
export function useAppBridge() {
  if (!window.shopify) {
    throw new Error('App Bridge has not finished loading. Make sure the CDN script is in index.html');
  }

  return window.shopify;
}
