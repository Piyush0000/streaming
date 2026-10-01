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

export interface Message {
  id: string;
  channelId: string;
  userId: string;
  username: string;
  content: string;
  createdAt: string;
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
  | 'leave-room';

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

export interface JoinRoomResult {
  routerRtpCapabilities: unknown; // mediasoup RtpCapabilities
  peers: { peerId: string; username: string; producerIds: string[] }[];
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
  kind: 'audio';
  rtpParameters: unknown;
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
  kind: 'audio';
  rtpParameters: unknown;
}

export interface NewProducerNotification {
  peerId: string;
  username: string;
  producerId: string;
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
