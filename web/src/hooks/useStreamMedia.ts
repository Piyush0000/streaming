import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PeerRole, SpeakRequestInfo } from '@streaming/shared-types';
import {
  VoiceClient,
  MediaRequestError,
  describeMediaJoinError,
  RemotePeerAudio,
  RemotePeerVideo,
} from '../lib/media';
import { useJoinToasts } from './useJoinToasts';
import { playJoinSound, playLeaveSound, playSpeakRequestSound } from '../lib/sounds';

export interface PeerState {
  peerId: string;
  userId: string;
  username: string;
  role: PeerRole;
}

/** One person in the room. A user with several tabs is several peers but ONE participant. */
export interface Participant {
  userId: string;
  username: string;
  role: PeerRole;
  peerIds: string[];
  isSelf: boolean;
}

export type JoinStatus = 'idle' | 'connecting' | 'connected' | 'error';
export type MicState = 'off' | 'starting' | 'live' | 'error';
export type SpeakRequestState = 'none' | 'pending';

export interface ScreenTile {
  key: string;
  username: string;
  stream: MediaStream;
  isLocal: boolean;
}

export interface StreamMediaEvents {
  /** Server forcibly removed us from the media room (kick / ban / remove-peer). */
  onRemoved: (reason: string) => void;
  /** The media room reported the stream ended. */
  onEnded: () => void;
  /** Transient, user-facing messages. */
  notify: (message: string, kind?: 'info' | 'success' | 'error' | 'warning') => void;
}

const ROLE_RANK: Record<PeerRole, number> = { host: 0, speaker: 1, listener: 2 };
const canSpeak = (role: PeerRole | null) => role === 'host' || role === 'speaker';

export function describeMediaError(err: unknown): string {
  const name = (err as DOMException)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return "Microphone access was blocked. Allow the microphone for this site in your browser settings, then press Retry.";
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No microphone was found. Plug one in, then press Retry.';
  }
  if (name === 'NotReadableError') {
    return 'Your microphone is in use by another app. Close it, then press Retry.';
  }
  return (err as Error)?.message || 'Could not start the microphone.';
}

/**
 * Owns the stream's media-service connection: joins as a listener (no mic
 * prompt), tracks roles/participants, manages the speak-request flow and the
 * local mic/screen producers. Chat lives in useStreamChat.
 */
export function useStreamMedia({
  streamId,
  token,
  enabled,
  events,
  selfUsername,
}: {
  streamId: string | undefined;
  token: string | undefined;
  /** Join while true; leaving/cleanup happens when it flips false or the stream changes. */
  enabled: boolean;
  events: StreamMediaEvents;
  selfUsername: string;
}) {
  const clientRef = useRef<VoiceClient | null>(null);
  const eventsRef = useRef(events);
  const joinToasts = useJoinToasts((m, k) => eventsRef.current.notify(m, k), 'the stream');
  const joinToastsRef = useRef(joinToasts);
  joinToastsRef.current = joinToasts;
  eventsRef.current = events;
  const selfUsernameRef = useRef(selfUsername);
  selfUsernameRef.current = selfUsername;

  const [status, setStatus] = useState<JoinStatus>('idle');
  const [joinError, setJoinError] = useState<string | null>(null);
  /** True when retrying can't help (no access / banned / ended), so the UI shouldn't offer Reconnect. */
  const [joinFatal, setJoinFatal] = useState(false);
  const [speakCooldownUntil, setSpeakCooldownUntil] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [peers, setPeers] = useState<Map<string, PeerState>>(new Map());
  const peersRef = useRef(peers);
  peersRef.current = peers;
  const [me, setMe] = useState<{ peerId: string; userId: string; isAdmin: boolean } | null>(null);
  const meRef = useRef(me);
  meRef.current = me;

  const [remoteAudio, setRemoteAudio] = useState<Map<string, RemotePeerAudio>>(new Map());
  const [remoteScreens, setRemoteScreens] = useState<Map<string, RemotePeerVideo>>(new Map());
  const [localScreen, setLocalScreen] = useState<MediaStream | null>(null);

  const [micState, setMicState] = useState<MicState>('off');
  const [micError, setMicError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);

  const [speakRequest, setSpeakRequest] = useState<SpeakRequestState>('none');
  const [pendingRequests, setPendingRequests] = useState<SpeakRequestInfo[]>([]);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const removedRef = useRef(false);

  const myPeer = me ? peers.get(me.peerId) : undefined;
  const myRole: PeerRole | null = myPeer?.role ?? null;
  const myRoleRef = useRef<PeerRole | null>(null);
  myRoleRef.current = myRole;

  // ---- mic -------------------------------------------------------------

  const startMic = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    setMicState('starting');
    setMicError(null);
    try {
      await client.startMic(mutedRef.current);
      // The role may have been revoked while the permission prompt was open.
      if (!canSpeak(myRoleRef.current)) {
        await client.stopMic();
        setMicState('off');
        setMicStream(null);
        return;
      }
      setMicState(client.isMicLive ? 'live' : 'off');
      setMicStream(client.micStream ?? null);
    } catch (err) {
      setMicState('error');
      setMicError(describeMediaError(err));
    }
  }, []);

  const stopMic = useCallback(async () => {
    const client = clientRef.current;
    setMicState('off');
    setMicError(null);
    setMicStream(null);
    mutedRef.current = false;
    setMuted(false);
    await client?.stopMic();
  }, []);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    clientRef.current?.setMicMuted(next);
  }, []);

  // ---- join / leave ----------------------------------------------------

  useEffect(() => {
    if (!enabled || !token || !streamId) return;
    let cancelled = false;
    let client: VoiceClient | null = null;
    removedRef.current = false;

    setStatus('connecting');
    setJoinError(null);
    setJoinFatal(false);

    (async () => {
      try {
        const c = await VoiceClient.connect(token, {
          onRemoteStream: (peer) => setRemoteAudio((prev) => new Map(prev).set(peer.peerId, peer)),
          onRemoteScreenShare: (peer) => setRemoteScreens((prev) => new Map(prev).set(peer.peerId, peer)),
          onRemoteScreenShareEnded: (peerId) =>
            setRemoteScreens((prev) => {
              if (!prev.has(peerId)) return prev;
              const next = new Map(prev);
              next.delete(peerId);
              return next;
            }),
          onPeerJoined: (peerId, username, info) => {
            const role = info?.role ?? 'listener';
            setPeers((prev) => new Map(prev).set(peerId, { peerId, username, userId: info?.userId ?? peerId, role }));
            // Only the stage is worth a sound - listener churn would be noise.
            if (canSpeak(role)) playJoinSound();
            joinToastsRef.current.peerJoined(username);
          },
          onPeerLeft: (peerId) => {
            const gone = peersRef.current.get(peerId);
            if (gone && canSpeak(gone.role)) playLeaveSound();
            if (gone) joinToastsRef.current.peerLeft(gone.username);
            setPeers((prev) => {
              if (!prev.has(peerId)) return prev;
              const next = new Map(prev);
              next.delete(peerId);
              return next;
            });
            setRemoteAudio((prev) => {
              if (!prev.has(peerId)) return prev;
              const next = new Map(prev);
              next.delete(peerId);
              return next;
            });
            // A requester that disconnects can no longer be approved.
            setPendingRequests((prev) => prev.filter((r) => r.peerId !== peerId));
          },
          onError: (message) => setMediaError(message),
          onRoleChanged: ({ peerId, userId, role }) => {
            const before = peersRef.current.get(peerId);
            setPeers((prev) => {
              const cur = prev.get(peerId);
              if (!cur) return prev;
              return new Map(prev).set(peerId, { ...cur, userId: cur.userId || userId, role });
            });
            const isMe = peerId === meRef.current?.peerId;
            if (isMe) {
              myRoleRef.current = role;
              if (canSpeak(role)) {
                playJoinSound();
                eventsRef.current.notify("You're now a speaker - your microphone is going live.", 'success');
                void startMic();
              } else {
                playLeaveSound();
                if (before && canSpeak(before.role)) {
                  eventsRef.current.notify('You were moved back to listeners.', 'info');
                }
                setSpeakRequest('none');
                void stopMic();
              }
            } else if (before && canSpeak(role) !== canSpeak(before.role)) {
              if (canSpeak(role)) playJoinSound();
              else playLeaveSound();
            }
          },
          onSpeakRequested: (req) => {
            setPendingRequests((prev) => (prev.some((r) => r.peerId === req.peerId) ? prev : [...prev, req]));
            playSpeakRequestSound();
          },
          onSpeakRequestResolved: ({ peerId, approved, cancelled, retryAfterMs }) => {
            setPendingRequests((prev) => prev.filter((r) => r.peerId !== peerId));
            if (peerId === meRef.current?.peerId) {
              setSpeakRequest('none');
              if (!approved && !cancelled) {
                if (retryAfterMs && retryAfterMs > 0) setSpeakCooldownUntil(Date.now() + retryAfterMs);
                const secs = retryAfterMs && retryAfterMs > 0 ? Math.ceil(retryAfterMs / 1000) : 0;
                eventsRef.current.notify(
                  secs > 0
                    ? `The host declined your request to speak. You can ask again in ${secs}s.`
                    : 'The host declined your request to speak.',
                  'info'
                );
              }
            }
          },
          onRemoved: (reason) => {
            removedRef.current = true;
            eventsRef.current.onRemoved(reason);
          },
          onStreamEnded: () => eventsRef.current.onEnded(),
          onDisconnected: () => {
            if (cancelled || removedRef.current) return;
            setStatus('error');
            setJoinError('Lost the connection to the stream room.');
          },
          onLocalProducerClosed: () => {
            setMicState('off');
            setMicStream(null);
          },
        });
        if (cancelled) {
          void c.leave();
          return;
        }
        client = c;
        clientRef.current = c;

        const result = await c.joinStream(streamId);
        if (cancelled) return;

        const initial = new Map<string, PeerState>();
        for (const p of result.peers) {
          initial.set(p.peerId, { peerId: p.peerId, userId: p.userId, username: p.username, role: p.role });
        }
        initial.set(result.you.peerId, {
          peerId: result.you.peerId,
          userId: result.you.userId,
          username: selfUsernameRef.current,
          role: result.you.role,
        });
        setPeers(initial);
        setMe({ peerId: result.you.peerId, userId: result.you.userId, isAdmin: result.you.isAdmin });
        meRef.current = { peerId: result.you.peerId, userId: result.you.userId, isAdmin: result.you.isAdmin };
        myRoleRef.current = result.you.role;
        setPendingRequests(result.pendingSpeakRequests);
        setSpeakRequest('none');
        setStatus('connected');

        if (canSpeak(result.you.role)) void startMic();
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setJoinError(describeMediaJoinError(err) || 'Could not join the stream room.');
        const code = err instanceof MediaRequestError ? err.code : undefined;
        setJoinFatal(code === 'forbidden' || code === 'banned' || code === 'stream_ended');
      }
    })();

    return () => {
      cancelled = true;
      const c = client;
      client = null;
      if (clientRef.current === c) clientRef.current = null;
      void c?.leave();
      setStatus('idle');
      setPeers(new Map());
      setMe(null);
      setRemoteAudio(new Map());
      setRemoteScreens(new Map());
      setLocalScreen(null);
      setPendingRequests([]);
      setSpeakRequest('none');
      setSpeakCooldownUntil(null);
      setMicState('off');
      setMicStream(null);
      setMuted(false);
      mutedRef.current = false;
    };
  }, [enabled, token, streamId, attempt, startMic, stopMic]);

  const reconnect = useCallback(() => setAttempt((a) => a + 1), []);

  // ---- speak requests ---------------------------------------------------

  const requestSpeak = useCallback(async () => {
    try {
      await clientRef.current?.requestToSpeak();
      setSpeakRequest('pending');
    } catch (err) {
      if (err instanceof MediaRequestError && err.code === 'speak_request_pending') {
        // Already queued server-side (e.g. from another tab): just reflect it.
        setSpeakRequest('pending');
        return;
      }
      if (err instanceof MediaRequestError && err.code === 'speak_cooldown') {
        setSpeakCooldownUntil(Date.now() + (err.retryAfterMs ?? 5000));
        return;
      }
      eventsRef.current.notify((err as Error).message, 'error');
    }
  }, []);

  const cancelSpeakRequest = useCallback(async () => {
    try {
      await clientRef.current?.cancelSpeakRequest();
    } catch (err) {
      eventsRef.current.notify((err as Error).message, 'error');
    }
    setSpeakRequest('none');
  }, []);

  const approveRequest = useCallback(async (peerId: string) => {
    try {
      await clientRef.current?.approveSpeaker(peerId);
      setPendingRequests((prev) => prev.filter((r) => r.peerId !== peerId));
    } catch (err) {
      eventsRef.current.notify((err as Error).message, 'error');
    }
  }, []);

  const denyRequest = useCallback(async (peerId: string) => {
    try {
      await clientRef.current?.denySpeaker(peerId);
      setPendingRequests((prev) => prev.filter((r) => r.peerId !== peerId));
    } catch (err) {
      eventsRef.current.notify((err as Error).message, 'error');
    }
  }, []);

  // ---- manager actions on participants (all peers of that user) ---------

  const peerIdsOfUser = useCallback((userId: string, onlyRole?: PeerRole) => {
    return Array.from(peersRef.current.values())
      .filter((p) => p.userId === userId && (!onlyRole || p.role === onlyRole))
      .map((p) => p.peerId);
  }, []);

  const demoteUser = useCallback(
    async (userId: string) => {
      const ids = peerIdsOfUser(userId, 'speaker');
      const results = await Promise.allSettled(ids.map((id) => clientRef.current!.demoteSpeaker(id)));
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) throw failed.reason;
    },
    [peerIdsOfUser]
  );

  const removeUserFromRoom = useCallback(
    async (userId: string) => {
      const ids = peerIdsOfUser(userId);
      if (ids.length === 0) throw new Error('That person has already left the room.');
      const results = await Promise.allSettled(ids.map((id) => clientRef.current!.removePeer(id)));
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) throw failed.reason;
    },
    [peerIdsOfUser]
  );

  // ---- screen share (host only) -----------------------------------------

  const startScreenShare = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      const stream = await client.startScreenShare();
      setLocalScreen(stream);
      stream.getVideoTracks()[0]?.addEventListener('ended', () => setLocalScreen(null));
    } catch (err) {
      const name = (err as DOMException)?.name;
      // Cancelling the browser's share-picker is not an error.
      if (name === 'NotAllowedError' || name === 'AbortError') return;
      setMediaError((err as Error).message);
    }
  }, []);

  const stopScreenShare = useCallback(async () => {
    await clientRef.current?.stopScreenShare();
    setLocalScreen(null);
  }, []);

  // ---- derived -----------------------------------------------------------

  const participants = useMemo<Participant[]>(() => {
    const byUser = new Map<string, Participant>();
    for (const p of peers.values()) {
      const existing = byUser.get(p.userId);
      const isSelf = p.userId === me?.userId;
      if (!existing) {
        byUser.set(p.userId, { userId: p.userId, username: p.username, role: p.role, peerIds: [p.peerId], isSelf });
      } else {
        existing.peerIds.push(p.peerId);
        if (!existing.username && p.username) existing.username = p.username;
        if (ROLE_RANK[p.role] < ROLE_RANK[existing.role]) existing.role = p.role;
      }
    }
    return Array.from(byUser.values());
  }, [peers, me]);

  const remoteAudioList = useMemo(() => Array.from(remoteAudio.values()), [remoteAudio]);

  const audioByUserId = useMemo(() => {
    const map = new Map<string, MediaStream>();
    for (const [peerId, audio] of remoteAudio) {
      const peer = peers.get(peerId);
      if (peer) map.set(peer.userId, audio.stream);
    }
    return map;
  }, [remoteAudio, peers]);

  const screens = useMemo<ScreenTile[]>(() => {
    const tiles: ScreenTile[] = [];
    if (localScreen) tiles.push({ key: 'local', username: 'You', stream: localScreen, isLocal: true });
    for (const v of remoteScreens.values()) {
      tiles.push({ key: v.producerId, username: v.username, stream: v.stream, isLocal: false });
    }
    return tiles;
  }, [localScreen, remoteScreens]);

  return {
    status,
    joinError,
    joinFatal,
    reconnect,
    me,
    myRole,
    participants,
    remoteAudio: remoteAudioList,
    audioByUserId,
    screens,
    isSharingScreen: !!localScreen,
    micState,
    micError,
    micStream,
    muted,
    mediaError,
    dismissMediaError: () => setMediaError(null),
    startMic,
    retryMic: startMic,
    toggleMute,
    speakRequest,
    speakCooldownUntil,
    requestSpeak,
    cancelSpeakRequest,
    pendingRequests,
    approveRequest,
    denyRequest,
    demoteUser,
    removeUserFromRoom,
    startScreenShare,
    stopScreenShare,
  };
}
