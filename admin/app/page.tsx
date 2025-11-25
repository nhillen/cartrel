import { requireAuth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Dashboard } from '@/components/views/Dashboard';

export default async function DashboardPage() {
  try {
    await requireAuth();
  } catch {
    redirect('/sign-in');
  }

  return <Dashboard />;
}
