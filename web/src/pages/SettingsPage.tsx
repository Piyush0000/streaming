import { FormEvent, useEffect, useRef, useState } from 'react';
import { LogOut, Trash2, Upload } from 'lucide-react';
import Avatar from '../components/Avatar';
import { CHARACTER_LIST } from '../components/characters/characters';
import ErrorBanner from '../components/ErrorBanner';
import Spinner from '../components/Spinner';
import { useSession } from '../context/SessionContext';
import { useToast } from '../context/ToastContext';
import { useBlocks } from '../hooks/useBlocks';
import { primeProfile } from '../hooks/useProfiles';
import {
  AVATAR_MAX_BYTES,
  BIO_MAX,
  DISPLAY_NAME_MAX,
  deleteAvatar,
  fetchOwnProfile,
  setAvatarPreset,
  updateOwnProfile,
  uploadAvatar,
  type OwnProfile,
} from '../lib/profiles';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export default function SettingsPage() {
  const { session, logout } = useSession();
  const { showToast } = useToast();
  const blocks = useBlocks();
  const token = session?.accessToken ?? '';

  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [unblocking, setUnblocking] = useState<string | null>(null);
  const [blockError, setBlockError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function apply(p: OwnProfile) {
    setProfile(p);
    setDisplayName(p.displayName === p.username ? '' : p.displayName);
    setBio(p.bio);
    primeProfile({ id: p.id, username: p.username, displayName: p.displayName, avatarUrl: p.avatarUrl, avatarPreset: p.avatarPreset });
  }

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchOwnProfile(token)
      .then((p) => !cancelled && apply(p))
      .catch((err) => !cancelled && setLoadError(err instanceof Error ? err.message : 'Could not load your profile.'));
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview]
  );

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    setSaveError(null);
    try {
      apply(await updateOwnProfile(token, { displayName: displayName.trim(), bio: bio.trim() }));
      showToast('Profile saved.', 'success');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  }

  async function onPickFile(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = '';
    if (!file || !profile) return;
    setAvatarError(null);
    if (!ALLOWED_TYPES.includes(file.type)) {
      setAvatarError('Use a PNG, JPG, WebP or GIF image.');
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarError('That image is too large (max 2MB).');
      return;
    }
    setPreview(URL.createObjectURL(file));
    setAvatarBusy(true);
    try {
      const url = await uploadAvatar(token, file);
      apply({ ...profile, avatarUrl: url, avatarPreset: null });
      showToast('Avatar updated.', 'success');
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Could not upload your avatar.');
    } finally {
      setAvatarBusy(false);
      setPreview(null);
    }
  }

  async function onRemoveAvatar() {
    if (!profile) return;
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      await deleteAvatar(token);
      apply({ ...profile, avatarUrl: null, avatarPreset: null });
      showToast('Avatar removed.', 'success');
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Could not remove your avatar.');
    } finally {
      setAvatarBusy(false);
    }
  }

  async function onPickPreset(id: string | null) {
    if (!profile || avatarBusy) return;
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      const preset = await setAvatarPreset(token, id);
      // Choosing a preset removes the uploaded photo server-side; clearing keeps whatever photo exists.
      apply({ ...profile, avatarPreset: preset, avatarUrl: preset ? null : profile.avatarUrl });
      showToast(preset ? 'Character avatar set.' : 'Character avatar cleared.', 'success');
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Could not update your avatar.');
    } finally {
      setAvatarBusy(false);
    }
  }

  async function onUnblock(id: string) {
    setUnblocking(id);
    setBlockError(null);
    try {
      await blocks.unblock(id);
    } catch (err) {
      setBlockError(err instanceof Error ? err.message : 'Could not unblock this user.');
    } finally {
      setUnblocking(null);
    }
  }

  const inputCls =
    'w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary outline-none focus:border-accent';
  const dirty = !!profile && (displayName.trim() !== (profile.displayName === profile.username ? '' : profile.displayName) || bio.trim() !== profile.bio);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8">
        <h1 className="text-xl font-bold text-text-primary">Settings</h1>

        <section aria-labelledby="profile-heading" className="rounded-xl border border-border bg-panel p-5">
          <h2 id="profile-heading" className="mb-4 text-sm font-semibold uppercase tracking-wide text-text-muted">
            Profile
          </h2>
          {loadError && <ErrorBanner message={loadError} />}
          {!profile && !loadError && (
            <div className="py-6" role="status" aria-label="Loading profile">
              <Spinner />
            </div>
          )}
          {profile && (
            <div className="flex flex-col gap-6">
              <div className="flex flex-wrap items-center gap-4">
                <Avatar name={profile.username} src={preview ?? profile.avatarUrl} preset={preview ? null : profile.avatarPreset} size={88} />
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={avatarBusy}
                      className="flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {avatarBusy ? <Spinner size={14} className="text-white" /> : <Upload size={14} />} Upload avatar
                    </button>
                    {(profile.avatarUrl || profile.avatarPreset) && (
                      <button
                        type="button"
                        onClick={() => void onRemoveAvatar()}
                        disabled={avatarBusy}
                        className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-hover disabled:opacity-50"
                      >
                        <Trash2 size={14} /> Remove
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-text-muted">PNG, JPG, WebP or GIF, up to 2MB.</p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept={ALLOWED_TYPES.join(',')}
                    className="hidden"
                    onChange={(e) => void onPickFile(e.target.files?.[0])}
                  />
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-text-secondary">Or pick a character</p>
                <div role="group" aria-label="Character avatars" className="grid grid-cols-5 gap-2 sm:grid-cols-5">
                  {CHARACTER_LIST.map((c) => {
                    const selected = profile.avatarPreset === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={selected}
                        aria-label={c.label}
                        title={selected ? `${c.label} (click to clear)` : c.label}
                        disabled={avatarBusy}
                        onClick={() => void onPickPreset(selected ? null : c.id)}
                        className={`flex flex-col items-center gap-1 rounded-xl border p-1.5 transition-all hover:scale-105 disabled:opacity-50 ${
                          selected ? 'border-accent bg-accent/10 ring-2 ring-accent/40' : 'border-border hover:border-accent/40'
                        }`}
                      >
                        <Avatar name={c.label} preset={c.id} size={48} />
                        <span className="w-full truncate text-center text-[10px] text-text-muted">{c.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {avatarError && <ErrorBanner message={avatarError} onDismiss={() => setAvatarError(null)} />}

              <form onSubmit={onSave} className="flex flex-col gap-4">
                <div>
                  <label htmlFor="username" className="mb-1 block text-xs font-medium text-text-secondary">
                    Username
                  </label>
                  <input id="username" value={profile.username} readOnly className={`${inputCls} opacity-70`} />
                </div>
                <div>
                  <label htmlFor="displayName" className="mb-1 block text-xs font-medium text-text-secondary">
                    Display name
                  </label>
                  <input
                    id="displayName"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    maxLength={DISPLAY_NAME_MAX}
                    placeholder={profile.username}
                    className={inputCls}
                  />
                  <p className="mt-1 text-xs text-text-muted">
                    {displayName.length}/{DISPLAY_NAME_MAX}. Leave empty to use your username.
                  </p>
                </div>
                <div>
                  <label htmlFor="bio" className="mb-1 block text-xs font-medium text-text-secondary">
                    Bio
                  </label>
                  <textarea
                    id="bio"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    maxLength={BIO_MAX}
                    rows={3}
                    className={`${inputCls} resize-none`}
                  />
                  <p className="mt-1 text-xs text-text-muted">
                    {bio.length}/{BIO_MAX}
                  </p>
                </div>
                <div>
                  <label htmlFor="email" className="mb-1 block text-xs font-medium text-text-secondary">
                    Email
                  </label>
                  <input id="email" value={profile.email} readOnly className={`${inputCls} opacity-70`} />
                  <p className="mt-1 text-xs text-text-muted">Only you can see your email.</p>
                </div>
                {saveError && <ErrorBanner message={saveError} onDismiss={() => setSaveError(null)} />}
                <div>
                  <button
                    type="submit"
                    disabled={saving || !dirty}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </section>

        <section aria-labelledby="blocked-heading" className="rounded-xl border border-border bg-panel p-5">
          <h2 id="blocked-heading" className="mb-4 text-sm font-semibold uppercase tracking-wide text-text-muted">
            Blocked users
          </h2>
          {(blockError || blocks.error) && <ErrorBanner message={(blockError ?? blocks.error)!} />}
          {blocks.loading && blocks.blocks.length === 0 && (
            <div className="py-2" role="status" aria-label="Loading blocked users">
              <Spinner />
            </div>
          )}
          {!blocks.loading && !blocks.error && blocks.blocks.length === 0 && (
            <p className="text-sm text-text-muted">You have not blocked anyone.</p>
          )}
          <ul className="flex flex-col gap-2">
            {blocks.blocks.map((b) => (
              <li key={b.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                <Avatar name={b.username} src={b.avatarUrl} preset={b.avatarPreset} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-primary">{b.displayName}</p>
                  <p className="truncate text-xs text-text-muted">@{b.username}</p>
                </div>
                <button
                  onClick={() => void onUnblock(b.id)}
                  disabled={unblocking === b.id}
                  className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-text-primary hover:bg-hover disabled:opacity-50"
                >
                  Unblock
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="account-heading" className="rounded-xl border border-border bg-panel p-5">
          <h2 id="account-heading" className="mb-4 text-sm font-semibold uppercase tracking-wide text-text-muted">
            Account
          </h2>
          <button
            onClick={logout}
            className="flex items-center gap-2 rounded-lg border border-danger/40 px-4 py-2 text-sm font-medium text-danger hover:bg-danger/10"
          >
            <LogOut size={16} /> Sign out
          </button>
        </section>
      </div>
    </div>
  );
}
