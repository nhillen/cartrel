import { useEffect, useState } from 'react';

// Declare the global shopify object from App Bridge CDN
declare global {
  interface Window {
    shopify?: {
      idToken(): Promise<string>;
      toast: {
        show(message: string, options?: { duration?: number; isError?: boolean }): void;
      };
    };
  }
}

/**
 * Hook to get and refresh session tokens using App Bridge v4
 * The shopify global is provided by the CDN script in index.html
 */
export function useSessionToken() {
  const [token, setToken] = useState<string>('');

  useEffect(() => {
    let isMounted = true;

    const refresh = async () => {
      try {
        // App Bridge v4 uses the global shopify object
        if (window.shopify?.idToken) {
          const newToken = await window.shopify.idToken();
          if (isMounted) {
            setToken(newToken);
          }
        }
      } catch (error) {
        console.error('Failed to refresh session token', error);
      }
    };

    // Refresh token every 45 seconds
    const interval = setInterval(refresh, 45 * 1000);

    refresh();
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return token;
}
