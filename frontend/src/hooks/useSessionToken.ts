import { useEffect, useState } from 'react';
import { getSessionToken } from '@shopify/app-bridge-utils';
import { useAppBridge } from './useAppBridge';

export function useSessionToken() {
  const appBridge = useAppBridge();
  const [token, setToken] = useState<string>('');

  useEffect(() => {
    let isMounted = true;
    const refresh = async () => {
      try {
        const newToken = await getSessionToken(appBridge);
        if (isMounted) {
          setToken(newToken);
        }
      } catch (error) {
        console.error('Failed to refresh session token', error);
      }
    };

    const interval = setInterval(refresh, 45 * 1000);

    refresh();
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [appBridge]);

  return token;
}
