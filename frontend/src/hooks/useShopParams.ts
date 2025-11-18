import { useMemo } from 'react';

export function useShopParams() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      shop: params.get('shop'),
      host: params.get('host'),
    };
  }, []);
}
