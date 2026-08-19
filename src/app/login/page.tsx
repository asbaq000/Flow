import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { one } from '@/lib/pg';
import AuthForm from '@/components/AuthForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect('/workspace');

  const row = await one<{ c: number }>('SELECT COUNT(*)::int AS c FROM users');
  // Only used to open on the signup tab for a brand-new workspace; the CEO
  // seat is claimed with a setup code, not by arriving first.
  return <AuthForm isEmptyWorkspace={(row?.c ?? 0) === 0} />;
}
