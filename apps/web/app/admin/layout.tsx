import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { AdminSidebar } from './AdminSidebar';
import styles from './layout.module.css';

export const metadata = {
  title: 'Admin | 八字命理平台',
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();

  if (!user) {
    redirect('/sign-in');
  }

  const role = (user.publicMetadata as Record<string, unknown>)?.role;
  if (role !== 'admin') {
    redirect('/dashboard');
  }

  const adminName = user.firstName || user.emailAddresses[0]?.emailAddress || 'Admin';

  return (
    <div className={styles.layout}>
      <AdminSidebar adminName={adminName} />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
