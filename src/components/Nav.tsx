'use client';

import {startSensorHistory} from '@/hooks/useSensorHistory';
import {syncSettings} from '@/lib/settings';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useEffect} from 'react';
import styles from './Nav.module.css';

const LINKS = [
  {href: '/', label: 'Dashboard'},
  {href: '/map', label: 'Map'},
  {href: '/sensors', label: 'Sensors'},
];

export default function Nav() {
  const pathname = usePathname();
  // nav is always mounted, so sensor history records no matter which page is open
  useEffect(() => {
    startSensorHistory();
    void syncSettings();
  }, []);
  return (
    <nav className={styles.nav}>
      {LINKS.map((link) => (
        <Link key={link.href} href={link.href} className={pathname === link.href ? styles.active : undefined}>
          {link.label}
        </Link>
      ))}
      <Link
        href="/settings"
        className={[styles.settings, pathname === '/settings' ? styles.active : ''].join(' ')}
        aria-label="Settings"
        title="Settings"
      >
        ⚙<span className={styles.settingsLabel}> Settings</span>
      </Link>
    </nav>
  );
}
