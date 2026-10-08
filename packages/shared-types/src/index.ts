// Domain entities shared across services.

export interface User {
  id: string;
  username: string;
  email: string;
  createdAt: string;
}

export type ChannelVisibility = 'public' | 'private';

/** Membership role within a channel. Public channels have an owner too, but membership never gates access to them. */
export type ChannelRole = 'owner' | 'mod' | 'member';

export interface Channel {
  id: string;
  name: string;
  topic: string | null;
  kind: 'text' | 'voice' | 'stream';
  createdBy: string;
  createdAt: string;
  visibility: ChannelVisibility;
  /** Owner-configured participant limit (voice only); null = platform default. */
  maxParticipants: number | null;
  /** The limit that is actually enforced for the room (voice: min(setting, env cap) or env default; stream: env; text: null). */
  effectiveMaxParticipants: number | null;
  /** The caller's role, or null when not a member (e.g. any public channel they never joined). */
  myRole: ChannelRole | null;
  /** Rows in channel_members (public channels: owner + invite joiners only). */
  memberCount: number;
}

// --- Private channels / members / invites (api-service REST) ---

export interface CreateChannelRequest {
  name: string;
  topic?: string;
  kind?: 'text' | 'voice';
  visibility?: ChannelVisibility;
  /** Voice only; 2..VOICE_ROOM_MAX_PEERS. */
  maxParticipants?: number;
}

export interface UpdateChannelRequest {
  name?: string;
  topic?: string | null;
  visibility?: ChannelVisibility;
  /** Voice only; null resets to the platform default. */
  maxParticipants?: number | null;
}

export interface ChannelMember {
  userId: string;
  username: string;
  role: ChannelRole;
  joinedAt: string;
}

/** Exactly one of username / email. */
export interface AddChannelMemberRequest {
  username?: string;
  email?: string;
}

export interface UpdateMemberRoleRequest {
  role: 'mod' | 'member';
}

export interface CreateInviteRequest {
  /** 1..720, default 168 (7 days). */
  expiresInHours?: number;
  /** 1..1000; omitted/null = unlimited. */
  maxUses?: number | null;
}

/** Response of POST /channels/:id/invites. The UI builds the link as `/invite/<token>`. */
export interface CreatedInvite {
  token: string;
  expiresAt: string;
  maxUses: number | null;
}

export type InviteStatus = 'active' | 'expired' | 'exhausted';

/** One row of GET /channels/:id/invites (revoked invites are excluded). */
export interface ChannelInvite {
  token: string;
  createdBy: string;
  createdByUsername: string;
  createdAt: string;
  expiresAt: string;
  maxUses: number | null;
  uses: number;
  status: InviteStatus;
}

export type InviteInvalidReason = 'expired' | 'revoked' | 'exhausted' | 'not_found';

/** Response of GET /invites/:token (always HTTP 200; check `valid`). */
export interface InvitePreview {
  valid: boolean;
  reason?: InviteInvalidReason;
  /** null only when reason === 'not_found'. */
  channel: {
    id: string;
    name: string;
    kind: Channel['kind'];
    visibility: ChannelVisibility;
    memberCount: number;
  } | null;
  /** The caller is already a member (accepting is a no-op). */
  alreadyMember: boolean;
}

/** Response of POST /invites/:token/accept. */
export interface InviteAcceptResponse {
  channel: Channel;
  alreadyMember: boolean;
}

/**
 * Stable `error` codes returned by the channel / invite REST endpoints
 * (HTTP status in comments; every error body also has a readable `message`
 * except the legacy 401/500 ones).
 */
export type ChannelApiErrorCode =
  | 'invalid_input' // 400
  | 'unsupported_channel_kind' // 400: stream channels are managed via /streams
  | 'missing_token' // 401
  | 'invalid_token' // 401
  | 'forbidden' // 403 (insufficient role)
  | 'owner_cannot_leave' // 403
  | 'cannot_remove_owner' // 403
  | 'cannot_change_owner' // 403
  | 'channel_not_found' // 404 (also: private channel the caller cannot see)
  | 'user_not_found' // 404
  | 'member_not_found' // 404
  | 'invite_not_found' // 404
  | 'channel_name_taken' // 409
  | 'already_member' // 409
  | 'channel_full' // 409 (PRIVATE_CHANNEL_MAX_MEMBERS reached)
  | 'too_many_invites' // 409 (50 active invites per channel)
  | 'invite_expired' // 410 (accept only)
  | 'invite_revoked' // 410
  | 'invite_exhausted' // 410
  | 'internal_error'; // 500

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
  visibility: ChannelVisibility;
  /** public -> always true; private -> member or platform admin. */
  canAccess: boolean;
  isMember: boolean;
  myRole: ChannelRole | null;
  /** Effective participant limit for the room (voice: setting bounded by env / env default; stream: env; text: null). */
  maxParticipants: number | null;
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

/** A member of a PRIVATE channel was removed or left (published only for private channels). */
export interface ChannelMemberRemovedEvent {
  type: 'channel-member-removed';
  channelId: string;
  userId: string;
  reason?: 'removed' | 'left';
}

export interface ChannelDeletedEvent {
  type: 'channel-deleted';
  channelId: string;
}

/** Visibility changed; consumers must re-verify everyone connected to the channel. */
export interface ChannelVisibilityChangedEvent {
  type: 'channel-visibility-changed';
  channelId: string;
  visibility?: ChannelVisibility;
}

export type ChannelEvent = ChannelMemberRemovedEvent | ChannelDeletedEvent | ChannelVisibilityChangedEvent;

/** Everything carried on the `stream.events` pub/sub channel (stream + channel lifecycle). */
export type StreamEvent = StreamModerationEvent | StreamEndedEvent | ChannelEvent;

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
  | 'not_member'
  | 'rate_limited'
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
  /** Present when code === 'rate_limited'. */
  retryAfterMs?: number;
}

export type ChannelRemovedReason = 'removed' | 'left' | 'deleted' | 'made_private';

/** Server -> client (to `user:<id>`): you lost access to a channel; the socket was removed from its room. */
export interface ChannelRemovedPayload {
  channelId: string;
  reason: ChannelRemovedReason;
  message: string;
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
  | 'ping'
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

/** Stable machine-readable reasons a media request failed (in addition to the readable `error`). */
export type MediaErrorCode =
  | 'room_full'
  | 'forbidden'
  | 'access_unavailable'
  | 'banned'
  | 'stream_ended'
  | 'speak_cooldown'
  | 'speak_request_pending';

export interface MediaResponse<T = unknown> {
  id: string;
  ok: boolean;
  payload?: T;
  error?: string;
  /** Present on some failures; absent for legacy generic errors. */
  code?: MediaErrorCode;
  /** code === 'room_full': unique users in the room / enforced limit. */
  capacity?: { current: number; max: number };
  /** code === 'speak_cooldown'. */
  retryAfterMs?: number;
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
  /** On a denial: the requester may ask again after this many ms. */
  retryAfterMs?: number;
}

/** To a peer just before the server closes its socket (kick/ban/remove-peer). */
export interface RemovedNotification {
  reason: string;
}

export interface StreamEndedNotification {
  streamId: string;
}
