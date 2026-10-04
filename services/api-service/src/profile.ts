// Pure helpers for user profiles. No env/db imports so they can be unit tested.
import { z } from 'zod';

export const DISPLAY_NAME_MAX = 32;
export const BIO_MAX = 190;
export const MAX_PROFILE_IDS = 50;

export const AVATAR_FILE_RE = /^[a-f0-9-]{36}\.(png|jpg|webp|gif)$/;

/** Rejects ASCII control characters (incl. NUL, ESC). `allowNewline` permits \n only. */
function hasControlChars(s: string, allowNewline: boolean): boolean {
  // eslint-disable-next-line no-control-regex
  return (allowNewline ? /[\u0000-\u0009\u000b-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(s);
}

export const profilePatchSchema = z
  .object({
    displayName: z
      .string({ invalid_type_error: 'displayName must be a string' })
      .trim()
      .max(DISPLAY_NAME_MAX, `displayName must be at most ${DISPLAY_NAME_MAX} characters`)
      .refine((s) => !hasControlChars(s, false), 'displayName contains invalid characters')
      .optional(),
    bio: z
      .string({ invalid_type_error: 'bio must be a string' })
      .transform((s) => s.replace(/\r\n?/g, '\n').trim())
      .refine((s) => s.length <= BIO_MAX, `bio must be at most ${BIO_MAX} characters`)
      .refine((s) => !hasControlChars(s, true), 'bio contains invalid characters')
      .optional(),
  })
  .strict()
  .refine((v) => v.displayName !== undefined || v.bio !== undefined, 'provide displayName and/or bio');

export type ProfilePatch = z.infer<typeof profilePatchSchema>;

/** Parses `ids=a,b,c` into unique valid UUIDs. Returns an error string for bad input. */
export function parseIdList(raw: unknown): { ids: string[] } | { error: string } {
  if (typeof raw !== 'string' || raw.trim() === '') return { error: 'ids: a comma-separated list of user ids is required' };
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const unique = Array.from(new Set(parts.map((p) => p.toLowerCase())));
  if (unique.length === 0) return { error: 'ids: a comma-separated list of user ids is required' };
  if (unique.length > MAX_PROFILE_IDS) return { error: `ids: at most ${MAX_PROFILE_IDS} ids per request` };
  const uuid = z.string().uuid();
  for (const id of unique) {
    if (!uuid.safeParse(id).success) return { error: 'ids: every id must be a valid UUID' };
  }
  return { ids: unique };
}

export function avatarUrlFor(file: string | null | undefined): string | null {
  return file && AVATAR_FILE_RE.test(file) ? `/api/users/avatar/${file}` : null;
}

/** Empty display name means "use the username". */
export function effectiveDisplayName(displayName: string | null | undefined, username: string): string {
  const d = (displayName ?? '').trim();
  return d === '' ? username : d;
}
