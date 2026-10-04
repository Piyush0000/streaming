import { ApiError, apiRequest } from './api';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

export interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface UserProfileDetail extends PublicProfile {
  bio: string;
  joinedAt: string;
  blockedByMe?: boolean;
}

export interface OwnProfile extends UserProfileDetail {
  email: string;
}

export interface BlockedUser extends PublicProfile {
  blockedAt: string;
}

export const DISPLAY_NAME_MAX = 32;
export const BIO_MAX = 190;
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export async function fetchProfiles(token: string, ids: string[]): Promise<PublicProfile[]> {
  const body = await apiRequest<{ profiles: PublicProfile[] }>(
    token,
    'GET',
    `/users/profiles?ids=${ids.map(encodeURIComponent).join(',')}`
  );
  return body.profiles;
}

export async function fetchOwnProfile(token: string): Promise<OwnProfile> {
  return (await apiRequest<{ profile: OwnProfile }>(token, 'GET', '/users/me/profile')).profile;
}

export async function fetchUserProfile(token: string, id: string): Promise<UserProfileDetail> {
  return (await apiRequest<{ profile: UserProfileDetail }>(token, 'GET', `/users/${encodeURIComponent(id)}/profile`))
    .profile;
}

export async function updateOwnProfile(
  token: string,
  patch: { displayName?: string; bio?: string }
): Promise<OwnProfile> {
  return (await apiRequest<{ profile: OwnProfile }>(token, 'PATCH', '/users/me/profile', patch)).profile;
}

export async function uploadAvatar(token: string, file: File): Promise<string | null> {
  const form = new FormData();
  form.append('image', file);
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/users/me/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the server. Check your connection.', {});
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    let message = typeof json.message === 'string' ? json.message : `Upload failed (${res.status}).`;
    if (res.status === 413) message = 'That image is too large (max 2MB).';
    const code = typeof json.error === 'string' ? json.error : `http_${res.status}`;
    throw new ApiError(res.status, code, message, json);
  }
  return typeof json.avatarUrl === 'string' ? json.avatarUrl : null;
}

export async function deleteAvatar(token: string): Promise<void> {
  await apiRequest(token, 'DELETE', '/users/me/avatar');
}

export async function fetchBlocks(token: string): Promise<BlockedUser[]> {
  return (await apiRequest<{ blocks: BlockedUser[] }>(token, 'GET', '/users/me/blocks')).blocks;
}

export async function blockUser(token: string, id: string): Promise<void> {
  await apiRequest(token, 'POST', `/users/${encodeURIComponent(id)}/block`);
}

export async function unblockUser(token: string, id: string): Promise<void> {
  await apiRequest(token, 'DELETE', `/users/${encodeURIComponent(id)}/block`);
}

export async function reportUser(token: string, id: string, reason: string): Promise<void> {
  await apiRequest(token, 'POST', `/users/${encodeURIComponent(id)}/report`, { reason });
}
