'use client';

/**
 * ProfileSwitcher — custom popover chip replacing the static
 * `<Link href="/dashboard/profiles">` icon in FortuneShell's subHeader.
 *
 * Opens a click-to-show popover listing all birth profiles + a
 * 「管理命盤」 footer link. Outside-click + Escape close pattern cribbed
 * from `InsufficientCreditsModal.tsx:36-50`.
 *
 * Hidden entirely when `profiles.length <= 1` — no value in a single-entry
 * switcher. Empty (0-profile) state is handled upstream by ErrorPanel's
 * `NO_PRIMARY_PROFILE` branch.
 *
 * z-index 60 popover wrapper sits above sticky header (50) and below
 * any modal (1000).
 */
import * as React from 'react';
import Link from 'next/link';
import { Check, RefreshCw, ChevronDown } from 'lucide-react';
import type { BirthProfile } from '../../lib/birth-profiles-api';
import styles from './ProfileSwitcher.module.css';

interface ProfileSwitcherProps {
  profiles: BirthProfile[];
  activeProfileId: string | undefined;
  onSelect: (id: string) => void;
  isLoading?: boolean;
}

const REL_LABEL: Record<BirthProfile['relationshipTag'], string> = {
  SELF: '本人',
  FAMILY: '家人',
  FRIEND: '朋友',
};

/** Format ISO YYYY-MM-DD birthDate to «1987.09.06». Defensive against
 *  the API returning a full ISO timestamp («1987-09-06T00:00:00.000Z»). */
function formatBirthDateChip(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[1]!}.${m[2]!}.${m[3]!}`;
}

export default function ProfileSwitcher({
  profiles,
  activeProfileId,
  onSelect,
  isLoading = false,
}: ProfileSwitcherProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  // Hide trigger entirely when there's only one (or zero) profile
  if (profiles.length <= 1) {
    return null;
  }

  const handleSelect = (id: string) => {
    setIsOpen(false);
    if (id !== activeProfileId) onSelect(id);
  };

  return (
    <div ref={containerRef} className={styles.container}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="切換命盤"
        title="切換命盤"
        disabled={isLoading}
      >
        <RefreshCw size={16} strokeWidth={2} aria-hidden="true" />
        <ChevronDown size={12} strokeWidth={2.5} aria-hidden="true" className={styles.chevron} />
      </button>

      {isOpen && (
        <div className={styles.popover} role="menu" aria-label="選擇命盤">
          <ul className={styles.list}>
            {profiles.map((p) => {
              const isActive = p.id === activeProfileId;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.row}
                    data-active={isActive}
                    onClick={() => handleSelect(p.id)}
                  >
                    <span className={styles.rowMain}>
                      <span className={styles.rowName}>{p.name}</span>
                      <span className={styles.rowMeta}>
                        <span className={styles.relTag}>{REL_LABEL[p.relationshipTag]}</span>
                        <span className={styles.birthChip}>{formatBirthDateChip(p.birthDate)}</span>
                      </span>
                    </span>
                    {isActive && (
                      <Check size={16} strokeWidth={2.5} aria-label="目前選擇" className={styles.checkIcon} />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className={styles.divider} aria-hidden="true" />
          <Link href="/dashboard/profiles" className={styles.footerLink} onClick={() => setIsOpen(false)}>
            管理命盤 →
          </Link>
        </div>
      )}
    </div>
  );
}
