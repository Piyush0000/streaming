import { useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ChannelRemovedPayload } from '@streaming/shared-types';
import { useChannels } from '../context/ChannelsContext';
import { useToast } from '../context/ToastContext';

/**
 * Handler for the chat socket's `channel:removed` event, which can arrive for
 * ANY channel the user was in. Shows a notice, refreshes the sidebar list and,
 * when it is the channel on screen, leaves it.
 */
export function useChannelRemoved() {
  const { channels, refresh } = useChannels();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const channelsRef = useRef(channels);
  channelsRef.current = channels;
  /** Channels whose removal the user triggered themselves (leave / delete) - they already got feedback. */
  const quietRef = useRef(new Set<string>());

  const markSelfInitiated = useCallback((channelId: string) => {
    quietRef.current.add(channelId);
    window.setTimeout(() => quietRef.current.delete(channelId), 15000);
  }, []);

  const handle = useCallback(
    (payload: ChannelRemovedPayload, opts: { current: boolean; fallbackPath: string }) => {
      const name = channelsRef.current.find((c) => c.id === payload.channelId)?.name;
      const label = name ? `#${name}` : 'this channel';
      const messages: Record<ChannelRemovedPayload['reason'], string> = {
        removed: `You were removed from ${label}.`,
        left: `You left ${label}.`,
        deleted: name ? `#${name} was deleted.` : 'This channel was deleted.',
        made_private: `${label} is now private, and you're not a member.`,
      };
      const quiet = quietRef.current.has(payload.channelId);
      if (!quiet) showToast(messages[payload.reason] ?? payload.message, payload.reason === 'left' ? 'info' : 'warning', 8000);
      void refresh();
      if (opts.current) navigate(opts.fallbackPath, { replace: true });
    },
    [navigate, refresh, showToast]
  );

  return { handleChannelRemoved: handle, markSelfInitiated };
}
