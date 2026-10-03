import type { ChannelRole } from '@streaming/shared-types';
import { Crown, Shield } from 'lucide-react';
import { cx } from '../lib/format';

const LABEL: Record<ChannelRole, string> = { owner: 'Owner', mod: 'Mod', member: 'Member' };

export default function RoleBadge({ role }: { role: ChannelRole }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        role === 'owner' && 'bg-warning/15 text-warning',
        role === 'mod' && 'bg-accent-soft text-accent',
        role === 'member' && 'bg-hover text-text-secondary'
      )}
    >
      {role === 'owner' && <Crown size={10} aria-hidden />}
      {role === 'mod' && <Shield size={10} aria-hidden />}
      {LABEL[role]}
    </span>
  );
}
