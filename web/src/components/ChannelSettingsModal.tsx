import { KeyboardEvent, useId, useRef, useState } from 'react';
import type { Channel } from '@streaming/shared-types';
import { Link2, Settings, Users } from 'lucide-react';
import Modal from './Modal';
import MembersTab from './MembersTab';
import InvitesTab from './InvitesTab';
import ChannelSettingsTab from './ChannelSettingsTab';
import { cx } from '../lib/format';

type TabId = 'members' | 'invites' | 'settings';

/**
 * Channel management dialog (bottom sheet on phones). Tabs are role-aware:
 * Members for everyone, Invites for owner/mod, Settings for the owner.
 */
export default function ChannelSettingsModal({
  channel,
  initialTab = 'members',
  onClose,
  onMembersChanged,
  onUpdated,
  onLeft,
  onDeleted,
}: {
  channel: Channel;
  initialTab?: TabId;
  onClose: () => void;
  onMembersChanged: () => void;
  onUpdated: (channel: Channel) => void;
  onLeft: () => void;
  onDeleted: () => void;
}) {
  const role = channel.myRole;
  const canInvite = role === 'owner' || role === 'mod';
  const isOwner = role === 'owner';

  const tabs: { id: TabId; label: string; icon: typeof Users }[] = [
    { id: 'members', label: 'Members', icon: Users },
    ...(canInvite ? [{ id: 'invites' as const, label: 'Invites', icon: Link2 }] : []),
    ...(isOwner ? [{ id: 'settings' as const, label: 'Settings', icon: Settings }] : []),
  ];
  const [tab, setTab] = useState<TabId>(tabs.some((t) => t.id === initialTab) ? initialTab : 'members');
  const baseId = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    setTab(tabs[next].id);
    tabRefs.current[tabs[next].id]?.focus();
  }

  return (
    <Modal
      size="lg"
      onClose={onClose}
      title={
        <span>
          #{channel.name} <span className="font-normal text-text-secondary">· Channel settings</span>
        </span>
      }
    >
      <div role="tablist" aria-label="Channel settings" className="flex border-b border-border px-2">
        {tabs.map((t, i) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              role="tab"
              id={`${baseId}-tab-${t.id}`}
              aria-selected={active}
              aria-controls={`${baseId}-panel-${t.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => onTabKey(e, i)}
              className={cx(
                'relative flex flex-1 items-center justify-center gap-1.5 px-3 py-3 text-sm font-medium transition-colors sm:flex-none sm:px-4',
                active ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
              )}
            >
              <t.icon size={15} aria-hidden />
              {t.label}
              {active && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" />}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`${baseId}-panel-${tab}`} aria-labelledby={`${baseId}-tab-${tab}`}>
        {tab === 'members' && <MembersTab channel={channel} onChanged={onMembersChanged} onLeft={onLeft} />}
        {tab === 'invites' && canInvite && <InvitesTab channel={channel} />}
        {tab === 'settings' && isOwner && <ChannelSettingsTab channel={channel} onUpdated={onUpdated} onDeleted={onDeleted} />}
      </div>
    </Modal>
  );
}
