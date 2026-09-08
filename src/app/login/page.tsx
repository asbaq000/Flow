import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { one } from '@/lib/pg';
import AuthForm from '@/components/AuthForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect('/workspace');

  const row = await one<{ c: number }>('SELECT COUNT(*)::int AS c FROM users');
  // Only used to open on the signup tab, in "start an organisation" mode, for
  // a brand-new install. Founding an organisation is what makes someone CEO.
  return <AuthForm isEmptyWorkspace={(row?.c ?? 0) === 0} />;
}
