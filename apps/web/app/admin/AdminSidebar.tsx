'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import styles from './layout.module.css';

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: '📊' },
  { href: '/admin/services', label: 'Services', icon: '⚙️' },
  { href: '/admin/plans', label: 'Plans', icon: '💎' },
  { href: '/admin/promos', label: 'Promo Codes', icon: '🎟️' },
  { href: '/admin/prompts', label: 'Prompts', icon: '📝' },
  { href: '/admin/users', label: 'Users', icon: '👥' },
  { href: '/admin/credit-packages', label: 'Credit Packages', icon: '🎁' },
  { href: '/admin/gateways', label: 'Gateways', icon: '💳' },
  { href: '/admin/ai-costs', label: 'AI Costs', icon: '🤖' },
  { href: '/admin/monetization', label: 'Monetization', icon: '💰' },
  { href: '/admin/audit-log', label: 'Audit Log', icon: '📋' },
];

export function AdminSidebar({ adminName }: { adminName: string }) {
  const pathname = usePathname();

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <Link href="/admin" className={styles.sidebarLogo}>
          Admin Panel
        </Link>
      </div>

      <nav className={styles.nav}>
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === '/admin'
              ? pathname === '/admin'
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
            >
              <span className={styles.navIcon}>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className={styles.sidebarFooter}>
        <div className={styles.adminInfo}>
          <UserButton afterSignOutUrl="/" />
          <span className={styles.adminName}>{adminName}</span>
        </div>
        <Link href="/" className={styles.backLink}>
          Back to Site
        </Link>
      </div>
    </aside>
  );
}
