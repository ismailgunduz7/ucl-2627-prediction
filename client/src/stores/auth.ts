import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api, setAccessToken, setActiveUserId } from '@/lib/api';
import { useLocaleStore } from '@/stores/locale';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  competitionId: string | null;
  /** Named so the account switcher can say which competition an account plays in. */
  competitionName: string | null;
  /** The language this account reads the game in, on any device. */
  language: string;
}

interface SessionResponse {
  user: AuthUser;
  accessToken: string;
}

interface SessionsResponse {
  accounts: AuthUser[];
  active: SessionResponse | null;
}

/**
 * Which account was last on screen. Only a hint for the next page load: the
 * cookies decide who is actually signed in, and the server ignores an id it
 * has no session for.
 */
const ACTIVE_KEY = 'ucl:active-account';

function rememberActive(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // Storage switched off: the first account in the list leads instead.
  }
}
function lastActive(): string | undefined {
  try {
    return localStorage.getItem(ACTIVE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null);
  /** Every account signed in on this browser, the active one included. */
  const accounts = ref<AuthUser[]>([]);
  const ready = ref(false); // set once the initial session restore completes

  const isAuthenticated = computed(() => user.value !== null);
  const isAdmin = computed(() => user.value?.isAdmin === true);
  /** The others, for the switcher. */
  const otherAccounts = computed(() => accounts.value.filter((a) => a.id !== user.value?.id));

  function upsert(account: AuthUser): void {
    const at = accounts.value.findIndex((a) => a.id === account.id);
    if (at >= 0) accounts.value[at] = account;
    else accounts.value.push(account);
  }

  function applySession(session: SessionResponse): void {
    setAccessToken(session.accessToken);
    setActiveUserId(session.user.id);
    user.value = session.user;
    upsert(session.user);
    rememberActive(session.user.id);
    // The account's language outranks whatever this browser last remembered.
    useLocaleStore().adoptAccount(session.user.language);
  }

  function clearSession(): void {
    setAccessToken(null);
    setActiveUserId(null);
    user.value = null;
    accounts.value = [];
    rememberActive(null);
    useLocaleStore().forgetAccount();
  }

  /**
   * Sign in. The server adds the account beside any that are already here
   * rather than replacing them, so this is both "log in" and "add account".
   */
  async function login(username: string, password: string): Promise<AuthUser> {
    const session = await api.post<SessionResponse>('/api/auth/login', { username, password });
    applySession(session);
    return session.user;
  }

  /** Put another account on screen. Its session is already open; this rotates it. */
  async function switchTo(userId: string): Promise<AuthUser> {
    if (userId === user.value?.id) return user.value;
    const session = await api.post<SessionResponse>('/api/auth/refresh', { userId });
    applySession(session);
    return session.user;
  }

  /**
   * Change your own password. The server revokes every session of the account,
   * so it answers with a fresh pair and this browser carries on signed in.
   */
  async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const session = await api.put<SessionResponse>('/api/auth/me/password', {
      currentPassword,
      newPassword,
    });
    applySession(session);
  }

  /** Signs every account out of this browser, which is what the API does too. */
  async function logout(): Promise<void> {
    try {
      await api.post('/api/auth/logout');
    } finally {
      clearSession();
    }
  }

  let inFlight: Promise<void> | null = null;

  /**
   * On app boot, ask which accounts this browser is carrying and open the one
   * that was last on screen.
   *
   * The router guard and the app shell both want this before `ready` flips, so
   * concurrent callers have to be handed the SAME request. Refresh tokens
   * rotate server-side and a reused one counts as theft, so firing the call
   * twice would get the second rejected and log the user straight back out of a
   * session that was perfectly good.
   */
  async function bootstrap(): Promise<void> {
    if (ready.value) return;
    const run = (inFlight ??= (async () => {
      try {
        const res = await api.post<SessionsResponse>('/api/auth/sessions', {
          activeUserId: lastActive(),
        });
        accounts.value = res.accounts;
        if (res.active) applySession(res.active);
        else clearSession();
      } catch {
        clearSession();
      } finally {
        ready.value = true;
        inFlight = null;
      }
    })());
    await run;
  }

  return {
    user,
    accounts,
    otherAccounts,
    ready,
    isAuthenticated,
    isAdmin,
    login,
    switchTo,
    changePassword,
    logout,
    bootstrap,
  };
});
