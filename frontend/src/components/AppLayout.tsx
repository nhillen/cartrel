import { Frame, Navigation } from '@shopify/polaris';
import {
  HomeIcon,
  LinkIcon,
  ProductIcon,
  OrderIcon,
  SettingsIcon,
  SearchIcon,
} from '@shopify/polaris-icons';
import { useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const navigationMarkup = (
    <Navigation location={location.pathname}>
      <Navigation.Section
        items={[
          {
            url: '/',
            label: 'Dashboard',
            icon: HomeIcon,
            selected: location.pathname === '/',
            onClick: () => navigate('/'),
          },
          {
            url: '/connections',
            label: 'Connections',
            icon: LinkIcon,
            selected: location.pathname.startsWith('/connections'),
            onClick: () => navigate('/connections'),
          },
          {
            url: '/catalog',
            label: 'Catalog',
            icon: ProductIcon,
            selected: location.pathname.startsWith('/catalog'),
            onClick: () => navigate('/catalog'),
          },
          {
            url: '/orders',
            label: 'Orders',
            icon: OrderIcon,
            selected: location.pathname.startsWith('/orders'),
            onClick: () => navigate('/orders'),
          },
          {
            url: '/marketplace',
            label: 'Partner Network',
            icon: SearchIcon,
            selected: location.pathname.startsWith('/marketplace'),
            onClick: () => navigate('/marketplace'),
          },
          {
            url: '/settings',
            label: 'Settings',
            icon: SettingsIcon,
            selected: location.pathname.startsWith('/settings'),
            onClick: () => navigate('/settings'),
          },
        ]}
      />
    </Navigation>
  );

  return (
    <Frame navigation={navigationMarkup}>
      {children}
    </Frame>
  );
}
