import { ReactNode, useMemo } from 'react';
import type { Participant, ScreenTile } from '../hooks/useStreamMedia';
import { useProfiles } from '../hooks/useProfiles';
import ParticipantGrid from './ParticipantGrid';
import type { TileModel } from './ParticipantTile';

/** Host + speakers as a Meet-style grid (camera or avatar), with the host's screen-share spotlighted. */
export default function StreamStage({
  hostId,
  hostUsername,
  participants,
  audioByUserId,
  cameraByUserId,
  localCamera,
  micStream,
  selfMuted,
  cameraBlocked,
  screens,
  renderActions,
}: {
  hostId: string;
  hostUsername: string;
  participants: Participant[];
  audioByUserId: Map<string, MediaStream>;
  /** Remote speakers' camera streams by userId. */
  cameraByUserId: Map<string, MediaStream>;
  /** Our own camera stream, when on. */
  localCamera: MediaStream | null;
  /** Our own mic stream, for the local speaking indicator. */
  micStream: MediaStream | null;
  selfMuted: boolean;
  /** Our camera was blocked / not found (shown on our tile). */
  cameraBlocked?: boolean;
  screens: ScreenTile[];
  renderActions?: (p: Participant) => ReactNode;
}) {
  const onStage = useMemo(
    () =>
      participants
        .filter((p) => p.role === 'host' || p.role === 'speaker')
        .sort((a, b) => (a.role === b.role ? 0 : a.role === 'host' ? -1 : 1)),
    [participants]
  );
  const hostPresent = onStage.some((p) => p.role === 'host');

  const profileIds = useMemo(() => [hostId, ...onStage.map((p) => p.userId)].filter(Boolean), [hostId, onStage]);
  const profiles = useProfiles(profileIds);

  const tiles = useMemo<TileModel[]>(() => {
    const list: TileModel[] = [];
    if (!hostPresent) {
      list.push({
        id: `offline:${hostId}`,
        name: hostUsername,
        avatarUrl: profiles.get(hostId)?.avatarUrl ?? null,
        avatarPreset: profiles.get(hostId)?.avatarPreset ?? null,
        badge: 'host',
        offline: true,
      });
    }
    for (const p of onStage) {
      const profile = profiles.get(p.userId);
      list.push({
        id: p.userId,
        name: profile?.displayName || p.username || (p.userId === hostId ? hostUsername : 'Guest'),
        avatarUrl: profile?.avatarUrl ?? null,
        avatarPreset: profile?.avatarPreset ?? null,
        videoStream: p.isSelf ? localCamera : cameraByUserId.get(p.userId) ?? null,
        audioStream: p.isSelf ? micStream : audioByUserId.get(p.userId) ?? null,
        isSelf: p.isSelf,
        micMuted: p.isSelf && selfMuted,
        badge: p.role === 'host' ? 'host' : 'speaker',
        cameraBlocked: p.isSelf && cameraBlocked,
        actions: p.isSelf || p.role === 'host' ? null : renderActions?.(p),
      });
    }
    return list;
  }, [
    hostPresent,
    hostId,
    hostUsername,
    onStage,
    profiles,
    localCamera,
    cameraByUserId,
    micStream,
    audioByUserId,
    selfMuted,
    cameraBlocked,
    renderActions,
  ]);

  const screenTiles = useMemo<TileModel[]>(
    () =>
      screens.map((s) => ({
        id: `screen:${s.key}`,
        name: s.isLocal ? 'You' : s.username,
        videoStream: s.stream,
        isScreen: true,
        isSelf: s.isLocal,
      })),
    [screens]
  );

  return (
    <section aria-label="Stage">
      <ParticipantGrid tiles={tiles} screens={screenTiles} />
    </section>
  );
}
