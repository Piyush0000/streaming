// Domain entities shared across services.

export interface User {
  id: string;
  username: string;
  email: string;
  createdAt: string;
}

export interface Channel {
  id: string;
  name: string;
  topic: string | null;
  kind: 'text' | 'voice' | 'stream';
  createdBy: string;
  createdAt: string;
}

export interface MessageAttachment {
  url: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface Message {
  id: string;
  channelId: string;
  userId: string;
  username: string;
  content: string;
  createdAt: string;
  attachment?: MessageAttachment | null;
}

// ---------------------------------------------------------------------------
// Auth / JWT
// ---------------------------------------------------------------------------

export interface AccessTokenClaims {
  sub: string; // user id
  username: string;
  email: string;
  type: 'access';
  iat?: number;
  exp?: number;
}

export interface RefreshTokenClaims {
  sub: string;
  jti: string; // refresh token id, matches refresh_tokens.id in Postgres
  type: 'refresh';
  iat?: number;
  exp?: number;
}

// ---------------------------------------------------------------------------
// Live streams (api-service REST + cross-service contracts)
// ---------------------------------------------------------------------------

/** Maximum warnings a user may hold; the next `warn` escalates to an automatic ban. */
export const STREAM_MAX_WARNINGS = 2;

export type StreamStatus = 'live' | 'ended';

/** Role of a participant inside a stream's audio room. */
export type PeerRole = 'host' | 'speaker' | 'listener';

/** A stream's id is also the id of its (kind='stream') channel. */
export interface Stream {
  id: string;
  hostId: string;
  hostUsername: string;
  title: string;
  description: string | null;
  status: StreamStatus;
  startedAt: string;
  endedAt: string | null;
}

/** The caller's own standing in a stream. */
export interface StreamViewerState {
  isHost: boolean;
  isAdmin: boolean;
  banned: boolean;
  muted: boolean;
  warnings: number;
}

export interface StreamDetailResponse {
  stream: Stream;
  me: StreamViewerState;
}

export interface CreateStreamRequest {
  title: string;
  description?: string;
}

export type StreamBridgeStatus = 'ok' | 'unavailable' | 'not_configured';

export interface StreamEligibility {
  eligible: boolean;
  admin: boolean;
  premium: boolean;
  followerCount: number;
  minFollowers: number;
  bridge: StreamBridgeStatus;
  /** Human-readable reasons the user is NOT eligible (empty when eligible). */
  reasons: string[];
}

export interface GuidelinesResponse {
  version: number;
  rules: string[];
}

export interface GuidelinesStatusResponse {
  version: number;
  accepted: boolean;
}

export type ModerationActionKind = 'warn' | 'mute' | 'unmute' | 'kick' | 'ban' | 'unban';

export interface ModerationRequest {
  targetUserId: string;
  action: ModerationActionKind;
  reason?: string;
}

/** Response of POST /streams/:id/moderation. */
export interface ModerationResult {
  /** The action actually recorded (a `warn` over the limit is recorded as `ban`). */
  action: ModerationActionKind;
  autoEscalated?: boolean;
  /** Present for warn / auto-escalation. */
  warnings?: number;
  /** Present for a plain warn. */
  max?: number;
}

/** One row of GET /streams/:id/moderation. */
export interface ModerationUserState {
  userId: string;
  username: string | null;
  warnings: number;
  muted: boolean;
  banned: boolean;
  lastActionAt: string;
}

export interface FollowStats {
  followers: number;
  isFollowing: boolean;
}

/** Response of the internal (service-to-service) access endpoint. */
export interface ChannelAccess {
  channelId: string;
  kind: Channel['kind'];
  isStream: boolean;
  status?: StreamStatus;
  hostId?: string;
  hostUsername?: string;
  title?: string;
  isHost: boolean;
  isAdmin: boolean;
  banned: boolean;
  muted: boolean;
  warnings: number;
}

// --- Redis pub/sub stream events (api-service publishes; chat+media subscribe) ---

export interface StreamModerationEvent {
  type: 'moderation';
  streamId: string;
  targetUserId: string;
  action: ModerationActionKind;
  reason?: string;
  warnings?: number;
  byUserId: string;
}

export interface StreamEndedEvent {
  type: 'stream-ended';
  streamId: string;
}

export type StreamEvent = StreamModerationEvent | StreamEndedEvent;

// ---------------------------------------------------------------------------
// Chat WebSocket (Socket.IO) event payloads
// ---------------------------------------------------------------------------

/** Client -> server: join a channel room. */
export interface ChatJoinPayload {
  channelId: string;
}

/** Client -> server: send a chat message. */
export interface ChatSendPayload {
  channelId: string;
  content: string;
  attachment?: MessageAttachment | null;
}

/** Client -> server: delete a message (author, or host/admin of that stream). */
export interface ChatDeletePayload {
  channelId: string;
  messageId: string;
}

/** Server -> client: history sent right after a successful join. */
export interface ChatHistoryPayload {
  channelId: string;
  messages: Message[];
}

/** Server -> client: a new message (live, fanned out via Redis Streams). */
export interface ChatMessagePayload {
  channelId: string;
  message: Message;
}

/** Server -> client (channel room): a message was soft-deleted. */
export interface ChatMessageDeletedPayload {
  channelId: string;
  messageId: string;
}

export type ChatErrorCode =
  | 'banned'
  | 'muted'
  | 'stream_ended'
  | 'access_unavailable'
  | 'forbidden'
  | 'not_found'
  | 'invalid_input'
  | 'internal_error';

export interface ChatErrorPayload {
  message: string;
  /** Machine-readable reason; absent on legacy generic errors. */
  code?: ChatErrorCode;
  channelId?: string;
}

/** Server -> client (to `user:<id>`): the host warned this user. */
export interface StreamWarningPayload {
  streamId: string;
  warnings: number;
  max: number;
  reason?: string;
}

/** Server -> client (to `user:<id>`): chat-mute state changed. */
export interface StreamMutedPayload {
  streamId: string;
  muted: boolean;
}

/** Server -> client (to `user:<id>`): removed from the stream (kick or ban). */
export interface StreamRemovedPayload {
  streamId: string;
  action: 'kick' | 'ban';
  reason?: string;
}

/** Server -> client (channel room): the stream ended. */
export interface StreamEndedPayload {
  streamId: string;
}

// ---------------------------------------------------------------------------
// Media (mediasoup) signaling payloads, sent over the media-service WebSocket
// ---------------------------------------------------------------------------

export type MediaClientRequestType =
  | 'join-room'
  | 'get-router-rtp-capabilities'
  | 'create-webrtc-transport'
  | 'connect-webrtc-transport'
  | 'produce'
  | 'consume'
  | 'resume-consumer'
  | 'close-producer'
  | 'leave-room'
  | 'request-speak'
  | 'cancel-speak-request'
  | 'approve-speaker'
  | 'deny-speaker'
  | 'demote-speaker'
  | 'remove-peer';

/** A peer may have a mic-audio producer AND a screen-share video producer active at once. */
export type ProducerKind = 'audio' | 'video';
export type ProducerSource = 'mic' | 'screen';

export interface MediaRequest<T = unknown> {
  id: string;
  type: MediaClientRequestType;
  payload: T;
}

export interface MediaResponse<T = unknown> {
  id: string;
  ok: boolean;
  payload?: T;
  error?: string;
}

/** Server -> client push notifications (not responses to a request). */
export type MediaNotificationType =
  | 'new-producer'
  | 'peer-joined'
  | 'peer-left'
  | 'producer-closed'
  | 'role-changed'
  | 'speak-requested'
  | 'speak-request-resolved'
  | 'removed'
  | 'stream-ended';

export interface MediaNotification<T = unknown> {
  notification: MediaNotificationType;
  payload: T;
}

export interface JoinRoomPayload {
  channelId: string;
}

export interface PeerProducerInfo {
  id: string;
  kind: ProducerKind;
  source: ProducerSource;
}

/** A participant as listed in join-room results. */
export interface PeerInfo {
  peerId: string;
  userId: string;
  username: string;
  role: PeerRole;
  producers: PeerProducerInfo[];
}

export interface SpeakRequestInfo {
  peerId: string;
  userId: string;
  username: string;
}

export interface JoinRoomResult {
  routerRtpCapabilities: unknown; // mediasoup RtpCapabilities
  /** Everyone already in the room (not including you). */
  peers: PeerInfo[];
  you: {
    peerId: string;
    userId: string;
    role: PeerRole;
    isAdmin: boolean;
  };
  /** Present for stream rooms only. */
  stream?: {
    id: string;
    title: string;
    hostId: string;
    hostUsername: string;
  };
  /** Only populated for the host / platform admins in stream rooms; [] otherwise. */
  pendingSpeakRequests: SpeakRequestInfo[];
}

export interface CreateWebRtcTransportPayload {
  direction: 'send' | 'recv';
}

export interface CreateWebRtcTransportResult {
  id: string;
  iceParameters: unknown;
  iceCandidates: unknown;
  dtlsParameters: unknown;
}

export interface ConnectWebRtcTransportPayload {
  transportId: string;
  dtlsParameters: unknown;
}

export interface ProducePayload {
  transportId: string;
  kind: ProducerKind;
  rtpParameters: unknown;
  /** Distinguishes a mic-audio producer from a screen-share video producer on the same peer. */
  source: ProducerSource;
}

export interface ProduceResult {
  id: string; // producer id
}

export interface ConsumePayload {
  transportId: string;
  producerId: string;
  rtpCapabilities: unknown;
}

export interface ConsumeResult {
  id: string; // consumer id
  producerId: string;
  kind: ProducerKind;
  source: ProducerSource;
  rtpParameters: unknown;
}

export interface CloseProducerPayload {
  producerId: string;
}

/** approve-speaker / deny-speaker / demote-speaker / remove-peer. */
export interface PeerTargetPayload {
  peerId: string;
}

export interface NewProducerNotification {
  peerId: string;
  username: string;
  producerId: string;
  kind: ProducerKind;
  source: ProducerSource;
}

export interface PeerJoinedNotification {
  peerId: string;
  userId: string;
  username: string;
  role: PeerRole;
}

export interface PeerLeftNotification {
  peerId: string;
}

export interface ProducerClosedNotification {
  producerId: string;
  peerId: string;
}

/** Broadcast to the whole room when a peer's role changes (approve / demote). */
export interface RoleChangedNotification {
  peerId: string;
  userId: string;
  role: PeerRole;
}

/** To the host (and admins present): a listener asked to speak. */
export interface SpeakRequestedNotification {
  peerId: string;
  userId: string;
  username: string;
}

/**
 * To the requester (and to host/admins so their pending lists stay in sync):
 * the request was approved, denied or cancelled.
 */
export interface SpeakRequestResolvedNotification {
  peerId: string;
  approved: boolean;
  cancelled?: boolean;
}

/** To a peer just before the server closes its socket (kick/ban/remove-peer). */
export interface RemovedNotification {
  reason: string;
}

export interface StreamEndedNotification {
  streamId: string;
}
