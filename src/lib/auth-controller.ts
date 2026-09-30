import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabaseConfig } from './env';
import { supabase } from './supabase';
import type { Profile, ProfileRole } from '@/types';

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated' | 'unconfigured';

export interface AuthState {
  status: AuthStatus;
  session: Session | null;
  profile: Profile | null;
}

const INITIAL: AuthState = { status: 'loading', session: null, profile: null };

const PROFILE_COLUMNS =
  'id, email, full_name, username, avatar_url, phone, role, status, is_active, email_verified_at, invited_at, activated_at, suspended_at, created_at, updated_at';

/** Must match the `profile-avatars` bucket created in migration 019. */
const AVATAR_BUCKET = 'profile-avatars';

/** Human-readable auth failures, so pages never show a raw Postgres message. */
export class AuthError extends Error {
  readonly code: string;

  constructor(message: string, code = 'auth_error') {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

function describeSignInError(message: string): AuthError {
  const text = message.toLowerCase();
  if (text.includes('invalid login credentials')) {
    return new AuthError('That email and password combination is not recognised.', 'invalid_credentials');
  }
  if (text.includes('email not confirmed')) {
    return new AuthError(
      'This account has not been verified yet. Enter the 6-digit code we emailed you.',
      'not_confirmed',
    );
  }
  if (text.includes('email rate limit') || text.includes('rate limit')) {
    return new AuthError(
      'Too many emails were requested. Wait a minute, then try again.',
      'rate_limited',
    );
  }

  // One person, one account. A repeat signup trips a unique index rather than
  // coming back as a friendly auth error, so the constraint name is the only
  // signal that the address or the number is already taken. The check order
  // matters: the phone index fires from inside handle_new_user, so it can arrive
  // with the email constraint in the same message.
  if (text.includes('user already registered') || text.includes('already been registered')) {
    return new AuthError('An account with that email already exists. Try signing in.', 'email_taken');
  }
  if (text.includes('profiles_phone_unique')) {
    return new AuthError(
      'That mobile number is already on an account. Use it to reach us instead of making a second one.',
      'phone_taken',
    );
  }
  if (text.includes('profiles_username_unique')) {
    // Should not be reachable: the generator suffixes past collisions. If it
    // ever is, the signup trigger lost a race and retrying will succeed.
    return new AuthError('Could not reserve that username. Please try again.', 'username_taken');
  }
  if (text.includes('profiles_email') && text.includes('unique')) {
    return new AuthError('An account with that email already exists. Try signing in.', 'email_taken');
  }

  return new AuthError(message, 'auth_error');
}

export interface SignUpInput {
  email: string;
  password: string;
  fullName: string;
  /**
   * Optional and deliberately not collected from customers. Registration is
   * email-only: the OTP proves the address, and `profiles.phone` is nullable with
   * a partial index that expects gaps. Orders collect a contact number at
   * checkout instead.
   */
  phone?: string;
}

export interface SignUpResult {
  /** True when the session already exists, i.e. email confirmations are off. */
  session: Session | null;
  needsVerification: boolean;
}

/**
 * Framework-agnostic auth store.
 *
 * Kept outside React so TanStack Router's `beforeLoad` can await a real
 * session without a render race, and so route guards never flash a login
 * screen for an already-signed-in user.
 */
class AuthController {
  private state: AuthState = isSupabaseConfigured
    ? INITIAL
    : { status: 'unconfigured', session: null, profile: null };

  private listeners = new Set<() => void>();

  private readyPromise: Promise<AuthState> | null = null;

  private readyResolve: (value: AuthState) => void = () => undefined;

  constructor() {
    if (!isSupabaseConfigured) {
      this.readyPromise = Promise.resolve(this.state);
      this.readyResolve(this.state);
      return;
    }

    this.readyPromise = new Promise<AuthState>((resolve) => {
      this.readyResolve = resolve;
    });

    void this.bootstrap();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private setState(next: AuthState): void {
    this.state = next;
    this.readyResolve(this.state);
    this.readyPromise = Promise.resolve(this.state);
    this.emit();
  }

  private async bootstrap(): Promise<void> {
    const { data } = await supabase.auth.getSession();
    await this.applySession(data.session);
  }

  private async applySession(session: Session | null): Promise<void> {
    if (!session) {
      this.setState({ status: 'anonymous', session: null, profile: null });
      return;
    }

    // Render the session immediately, then resolve the role.
    this.state = { status: 'loading', session, profile: this.state.profile };
    this.emit();

    const profile = await fetchProfile(session.user.id);
    this.setState({ status: 'authenticated', session, profile });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): AuthState => this.state;

  /** Resolves once the initial session + profile lookup has settled. */
  ready = (): Promise<AuthState> => this.readyPromise ?? Promise.resolve(this.state);

  refreshProfile = async (): Promise<Profile | null> => {
    const userId = this.state.session?.user?.id;
    if (!userId) return null;
    const profile = await fetchProfile(userId);
    this.setState({ ...this.state, profile });
    return profile;
  };

  /* ------------------------------------------------------------ customer */

  /**
   * Registers a customer. `handle_new_user` forces `role = 'customer'` no matter
   * what the caller puts in metadata, so this cannot mint staff.
   */
  async signUp({ email, password, fullName, phone }: SignUpInput): Promise<SignUpResult> {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: { data: { full_name: fullName.trim(), phone: phone?.trim() || null } },
    });

    if (error) throw describeSignInError(error.message);

    // No session means the project requires email confirmation.
    if (!data.session) return { session: null, needsVerification: true };

    await this.applySession(data.session);
    return { session: data.session, needsVerification: false };
  }

  /** Verifies the 6-digit signup code and signs the customer in. */
  async verifySignupCode(email: string, token: string): Promise<void> {
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: token.trim(),
      type: 'email',
    });
    if (error) throw describeSignInError(error.message);

    // verifyOtp establishes the session in the client; read it back.
    const { data } = await supabase.auth.getSession();
    await this.applySession(data.session);
  }

  async resendVerification(email: string): Promise<void> {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim().toLowerCase(),
    });
    if (error) throw describeSignInError(error.message);
  }

  async requestPasswordReset(email: string, redirectTo: string): Promise<void> {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo,
    });
    if (error) throw describeSignInError(error.message);
  }

  /* --------------------------------------------------------------- login */

  async signIn(email: string, password: string): Promise<Profile | null> {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) throw describeSignInError(error.message);
    await this.applySession(data.session);
    return this.state.profile;
  }

  /**
   * Signs in and refuses the session unless the account is an active staff
   * member or admin. Signing out again matters: without it a customer who
   * guessed the staff URL would keep a valid session in the browser.
   */
  async signInForConsole(email: string, password: string): Promise<Profile> {
    const profile = await this.signIn(email, password);
    if (!profile || !isConsoleRole(profile.role) || !profile.is_active || profile.status !== 'active') {
      await this.signOut();
      throw new AuthError('This account does not have console access.', 'forbidden');
    }
    return profile;
  }

  async signOut(): Promise<void> {
    await supabase.auth.signOut();
    this.setState({ status: 'anonymous', session: null, profile: null });
  }

  /**
   * The current access token, for calls that need proof of identity beyond what
   * the anon key plus RLS can express — the `manage-staff` function, which needs
   * to know the caller is an active admin before it touches the service role.
   *
   * Reads from the Supabase session rather than the cached state, because a
   * silently expired token would be rejected by the function with a 401 that
   * looks like a permissions problem.
   */
  async getAccessToken(): Promise<string | null> {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data.session?.access_token ?? null;
  }

  /**
   * Only the display name is self-writable.
   *
   * `email` and `phone` are deliberately absent from this payload. Migration
   * 019 dropped `phone` from the column-level UPDATE grant, so sending it here
   * would fail with a permission error on every save. Both are identity fields
   * that OTP verification and dispatch depend on, which is why changing them
   * is a support action rather than a self-service one.
   */
  async updateOwnProfile(input: { fullName: string }): Promise<Profile | null> {
    const userId = this.state.session?.user?.id;
    if (!userId) throw new AuthError('You are not signed in.', 'anonymous');

    const { error } = await supabase
      .from('profiles')
      .update({ full_name: input.fullName.trim() })
      .eq('id', userId);
    if (error) throw new AuthError(error.message, 'profile_update_failed');

    return this.refreshProfile();
  }

  /**
   * Stores the public URL of an already-uploaded avatar. Kept separate from the
   * name so a failed picture upload cannot roll back the display name, and vice
   * versa. `avatar_url` is in the 019 UPDATE grant, so this is the only other
   * profile column the client can write.
   */
  async updateOwnAvatar(avatarUrl: string | null): Promise<Profile | null> {
    const userId = this.state.session?.user?.id;
    if (!userId) throw new AuthError('You are not signed in.', 'anonymous');

    const { error } = await supabase
      .from('profiles')
      .update({ avatar_url: avatarUrl })
      .eq('id', userId);
    if (error) throw new AuthError(error.message, 'profile_update_failed');

    return this.refreshProfile();
  }

  /**
   * Uploads a customer picture and points the profile at it.
   *
   * The object key is `avatars/<user id>/<file>.<ext>`, and the first path
   * segment must equal the caller's own id -- that is the constraint the
   * `profile_avatars_insert_own` RLS policy enforces, so a customer cannot
   * overwrite somebody else's picture by crafting a key. The previous object is
   * removed afterwards, but only on success: a failed delete must not lose the
   * avatar the profile is already pointing at.
   */
  async uploadOwnAvatar(file: File): Promise<Profile | null> {
    const userId = this.state.session?.user?.id;
    if (!userId) throw new AuthError('You are not signed in.', 'anonymous');

    if (file.size > 2 * 1024 * 1024) {
      throw new AuthError('Profile photos must be 2 MB or smaller.', 'avatar_too_large');
    }

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
    if (!allowed.includes(file.type)) {
      throw new AuthError('Use a JPEG, PNG, WebP or AVIF image.', 'avatar_type');
    }

    const previousPath = this.state.profile?.avatar_url ?? null;
    const extension = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
      || 'jpg';
    const path = `avatars/${userId}/${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, file, { cacheControl: '31536000', upsert: false, contentType: file.type });
    if (uploadError) throw new AuthError(uploadError.message, 'avatar_upload_failed');

    const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);

    // Supabase caches aggressively on the public CDN, so the URL is busted with
    // a query parameter; otherwise a replaced photo keeps showing the old one.
    const updated = await this.updateOwnAvatar(`${data.publicUrl}?v=${Date.now()}`);

    if (previousPath) void this.removeStoredAvatar(previousPath);
    return updated;
  }

  /** Best-effort cleanup of a superseded avatar. Never throws. */
  private async removeStoredAvatar(publicUrl: string): Promise<void> {
    if (!supabaseConfig.url) return;

    const { origin, pathname } = new URL(publicUrl);
    // Only ever delete from our own bucket on our own project. Without this a
    // tampered avatar_url could aim the delete at an arbitrary storage path.
    if (origin !== new URL(supabaseConfig.url).origin) return;
    if (!pathname.startsWith(`/${AVATAR_BUCKET}/`)) return;

    const path = decodeURIComponent(pathname.slice(`/${AVATAR_BUCKET}/`.length));
    const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([path]);
    if (error) console.warn('[auth] could not remove the old avatar', error);
  }

  /** Called by the Supabase auth listener registered in main.tsx. */
  handleExternalSession(session: Session | null): void {
    if (session?.user?.id === this.state.session?.user?.id) return;
    void this.applySession(session);
  }
}

export function isConsoleRole(role: ProfileRole | null | undefined): boolean {
  return role === 'staff' || role === 'admin';
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('[auth] failed to load profile', error);
    return null;
  }
  return (data as Profile | null) ?? null;
}

export const authController = new AuthController();
