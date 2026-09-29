import { useCallback, useSyncExternalStore } from 'react';
import { authController, isConsoleRole, type AuthState } from '@/lib/auth-controller';
import type { Profile } from '@/types';

export function useAuthState(): AuthState {
  return useSyncExternalStore(
    authController.subscribe,
    authController.getState,
    authController.getState,
  );
}

export interface UseAuthResult extends AuthState {
  isAuthenticated: boolean;
  isAdmin: boolean;
  isStaff: boolean;
  isCustomer: boolean;
  /**
   * The email must be confirmed *and* the account active. An unverified
   * customer can hold a Supabase session, so the UI must not treat mere
   * authentication as permission to order.
   */
  isEmailVerified: boolean;
  /** The single gate for cart and checkout. */
  canShop: boolean;
  /** Staff console access: admin or staff, active and confirmed. */
  canUseConsole: boolean;
  signIn: (email: string, password: string) => Promise<Profile | null>;
  signInForConsole: (email: string, password: string) => Promise<Profile>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<Profile | null>;
  /** Saves the display name. Contact details are intentionally not editable. */
  updateOwnProfile: (input: { fullName: string }) => Promise<Profile | null>;
  /** Saves the public URL of an uploaded avatar, or null to clear it. */
  updateOwnAvatar: (avatarUrl: string | null) => Promise<Profile | null>;
  /** Uploads a picture to `profile-avatars` and points the profile at it. */
  uploadOwnAvatar: (file: File) => Promise<Profile | null>;
  /** Bearer token for privileged Edge Function calls. */
  getAccessToken: () => Promise<string | null>;
}

export function useAuth(): UseAuthResult {
  const state = useAuthState();

  const signIn = useCallback(
    (email: string, password: string) => authController.signIn(email, password),
    [],
  );

  const signInForConsole = useCallback(
    (email: string, password: string) => authController.signInForConsole(email, password),
    [],
  );

  const signOut = useCallback(() => authController.signOut(), []);
  const refreshProfile = useCallback(() => authController.refreshProfile(), []);
  const updateOwnProfile = useCallback(
    (input: { fullName: string }) => authController.updateOwnProfile(input),
    [],
  );
  const updateOwnAvatar = useCallback(
    (avatarUrl: string | null) => authController.updateOwnAvatar(avatarUrl),
    [],
  );
  const uploadOwnAvatar = useCallback((file: File) => authController.uploadOwnAvatar(file), []);
  const getAccessToken = useCallback(() => authController.getAccessToken(), []);

  const profile = state.profile;
  const active = profile?.is_active === true && profile?.status === 'active';
  const verified = !!profile?.email_verified_at;

  return {
    ...state,
    isAuthenticated: state.status === 'authenticated',
    isAdmin: profile?.role === 'admin' && active,
    isStaff: profile?.role === 'staff' && active,
    isCustomer: profile?.role === 'customer' && active,
    isEmailVerified: verified,
    canShop: profile?.role === 'customer' && active && verified,
    canUseConsole: isConsoleRole(profile?.role) && active,
    signIn,
    signInForConsole,
    signOut,
    refreshProfile,
    updateOwnProfile,
    updateOwnAvatar,
    uploadOwnAvatar,
    getAccessToken,
  };
}
