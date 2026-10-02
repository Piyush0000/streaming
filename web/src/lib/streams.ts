import type {
  FollowStats,
  GuidelinesResponse,
  GuidelinesStatusResponse,
  ModerationActionKind,
  ModerationResult,
  ModerationUserState,
  Stream,
  StreamDetailResponse,
  StreamEligibility,
} from '@streaming/shared-types';
import { apiRequest } from './api';

export function getGuidelines(token: string) {
  return apiRequest<GuidelinesResponse>(token, 'GET', '/guidelines');
}

export function getGuidelinesStatus(token: string) {
  return apiRequest<GuidelinesStatusResponse>(token, 'GET', '/guidelines/status');
}

export function acceptGuidelines(token: string, version: number) {
  return apiRequest<GuidelinesStatusResponse>(token, 'POST', '/guidelines/accept', { version });
}

export function getEligibility(token: string) {
  return apiRequest<StreamEligibility>(token, 'GET', '/streams/eligibility');
}

export async function createStream(token: string, title: string, description?: string): Promise<Stream> {
  const res = await apiRequest<{ stream: Stream }>(token, 'POST', '/streams', {
    title,
    ...(description ? { description } : {}),
  });
  return res.stream;
}

export async function listLiveStreams(token: string): Promise<Stream[]> {
  const res = await apiRequest<{ streams: Stream[] }>(token, 'GET', '/streams?status=live');
  return res.streams ?? [];
}

export function getStream(token: string, id: string) {
  return apiRequest<StreamDetailResponse>(token, 'GET', `/streams/${id}`);
}

export async function endStream(token: string, id: string): Promise<void> {
  await apiRequest(token, 'POST', `/streams/${id}/end`);
}

export function moderate(
  token: string,
  streamId: string,
  targetUserId: string,
  action: ModerationActionKind,
  reason?: string
) {
  return apiRequest<ModerationResult>(token, 'POST', `/streams/${streamId}/moderation`, {
    targetUserId,
    action,
    ...(reason ? { reason } : {}),
  });
}

export async function listModeration(token: string, streamId: string): Promise<ModerationUserState[]> {
  const res = await apiRequest<{ users: ModerationUserState[] }>(token, 'GET', `/streams/${streamId}/moderation`);
  return res.users;
}

export function getFollowStats(token: string, userId: string) {
  return apiRequest<FollowStats>(token, 'GET', `/users/${userId}/follow-stats`);
}

export function followUser(token: string, userId: string) {
  return apiRequest<FollowStats>(token, 'POST', `/users/${userId}/follow`);
}

export function unfollowUser(token: string, userId: string) {
  return apiRequest<FollowStats>(token, 'DELETE', `/users/${userId}/follow`);
}
