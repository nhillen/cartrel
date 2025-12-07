import { Frame } from '@shopify/polaris';
import type { ReactNode } from 'react';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  // Navigation is handled by App Bridge <ui-nav-menu> in index.html
  return (
    <Frame>
      {children}
    </Frame>
  );
}
