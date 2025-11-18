import { useContext } from 'react';
import { AppBridgeContext } from '../context/AppBridgeContext';

export function useAppBridge() {
  const appBridge = useContext(AppBridgeContext);

  if (!appBridge) {
    throw new Error('App Bridge has not finished booting');
  }

  return appBridge;
}
