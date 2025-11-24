import { requireAuth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  try {
    await requireAuth();
  } catch {
    redirect('/sign-in');
  }

  return <DashboardClient />;
}
