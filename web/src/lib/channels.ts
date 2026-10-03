import type {
  AddChannelMemberRequest,
  Channel,
  ChannelInvite,
  ChannelMember,
  CreateChannelRequest,
  CreateInviteRequest,
  CreatedInvite,
  InviteAcceptResponse,
  InvitePreview,
  UpdateChannelRequest,
  UpdateMemberRoleRequest,
} from '@streaming/shared-types';
import { apiRequest, ApiError } from './api';

/** REST wrappers for private channels, members and invites (api-service). */

const enc = encodeURIComponent;

export async function getChannel(token: string, channelId: string): Promise<Channel> {
  const res = await apiRequest<{ channel: Channel }>(token, 'GET', `/channels/${enc(channelId)}`);
  return res.channel;
}

export async function createChannel(token: string, body: CreateChannelRequest): Promise<Channel> {
  const res = await apiRequest<{ channel: Channel }>(token, 'POST', '/channels', body);
  return res.channel;
}

export async function updateChannel(token: string, channelId: string, body: UpdateChannelRequest): Promise<Channel> {
  const res = await apiRequest<{ channel: Channel }>(token, 'PATCH', `/channels/${enc(channelId)}`, body);
  return res.channel;
}

export async function deleteChannel(token: string, channelId: string): Promise<void> {
  await apiRequest(token, 'DELETE', `/channels/${enc(channelId)}`);
}

export async function listMembers(token: string, channelId: string): Promise<ChannelMember[]> {
  const res = await apiRequest<{ members: ChannelMember[] }>(token, 'GET', `/channels/${enc(channelId)}/members`);
  return res.members;
}

export async function addMember(token: string, channelId: string, body: AddChannelMemberRequest): Promise<ChannelMember> {
  const res = await apiRequest<{ member: ChannelMember }>(token, 'POST', `/channels/${enc(channelId)}/members`, body);
  return res.member;
}

/** Remove a member, or leave the channel when `userId` is the caller. */
export async function removeMember(token: string, channelId: string, userId: string): Promise<void> {
  await apiRequest(token, 'DELETE', `/channels/${enc(channelId)}/members/${enc(userId)}`);
}

export async function setMemberRole(
  token: string,
  channelId: string,
  userId: string,
  role: UpdateMemberRoleRequest['role']
): Promise<ChannelMember> {
  const res = await apiRequest<{ member: ChannelMember }>(
    token,
    'PATCH',
    `/channels/${enc(channelId)}/members/${enc(userId)}`,
    { role } satisfies UpdateMemberRoleRequest
  );
  return res.member;
}

export function createInvite(token: string, channelId: string, body: CreateInviteRequest): Promise<CreatedInvite> {
  return apiRequest<CreatedInvite>(token, 'POST', `/channels/${enc(channelId)}/invites`, body);
}

export async function listInvites(token: string, channelId: string): Promise<ChannelInvite[]> {
  const res = await apiRequest<{ invites: ChannelInvite[] }>(token, 'GET', `/channels/${enc(channelId)}/invites`);
  return res.invites;
}

export async function revokeInvite(token: string, channelId: string, inviteToken: string): Promise<void> {
  await apiRequest(token, 'DELETE', `/channels/${enc(channelId)}/invites/${enc(inviteToken)}`);
}

export function getInvitePreview(token: string, inviteToken: string): Promise<InvitePreview> {
  return apiRequest<InvitePreview>(token, 'GET', `/invites/${enc(inviteToken)}`);
}

export function acceptInvite(token: string, inviteToken: string): Promise<InviteAcceptResponse> {
  return apiRequest<InviteAcceptResponse>(token, 'POST', `/invites/${enc(inviteToken)}/accept`);
}

export function inviteUrl(inviteToken: string): string {
  return `${window.location.origin}/invite/${inviteToken}`;
}

/** True when the API says this channel does not exist or the caller may not see it. */
export function isChannelGone(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.code === 'channel_not_found');
}
