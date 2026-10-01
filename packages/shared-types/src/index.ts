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
  kind: 'text' | 'voice';
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

export interface ChatErrorPayload {
  message: string;
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
  | 'leave-room';

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
  | 'producer-closed';

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

export interface JoinRoomResult {
  routerRtpCapabilities: unknown; // mediasoup RtpCapabilities
  peers: { peerId: string; username: string; producers: PeerProducerInfo[] }[];
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

export interface NewProducerNotification {
  peerId: string;
  username: string;
  producerId: string;
  kind: ProducerKind;
  source: ProducerSource;
}

export interface PeerJoinedNotification {
  peerId: string;
  username: string;
}

export interface PeerLeftNotification {
  peerId: string;
}

export interface ProducerClosedNotification {
  producerId: string;
  peerId: string;
}
