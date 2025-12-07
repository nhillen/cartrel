import type { ReactNode } from 'react';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  // For embedded apps, navigation is handled by App Bridge <ui-nav-menu> in index.html
  // We don't use Polaris Frame as it conflicts with App Bridge navigation
  return <>{children}</>;
}
