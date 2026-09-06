import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api, setAccessToken } from '@/lib/api';
import { useLocaleStore } from '@/stores/locale';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  competitionId: string | null;
  /** The language this account reads the game in, on any device. */
  language: string;
}

interface SessionResponse {
  user: AuthUser;
  accessToken: string;
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null);
  const ready = ref(false); // set once the initial silent-refresh completes

  const isAuthenticated = computed(() => user.value !== null);
  const isAdmin = computed(() => user.value?.isAdmin === true);

  function applySession(session: SessionResponse): void {
    setAccessToken(session.accessToken);
    user.value = session.user;
    // The account's language outranks whatever this browser last remembered.
    useLocaleStore().adoptAccount(session.user.language);
  }

  async function login(username: string, password: string): Promise<void> {
    const session = await api.post<SessionResponse>('/api/auth/login', { username, password });
    applySession(session);
  }

  async function logout(): Promise<void> {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setAccessToken(null);
      user.value = null;
      useLocaleStore().forgetAccount();
    }
  }

  let inFlight: Promise<void> | null = null;

  /**
   * On app boot, attempt a silent refresh from the httpOnly cookie.
   *
   * The router guard and the app shell both want this before `ready` flips, so
   * concurrent callers have to be handed the SAME request. Refresh tokens
   * rotate server-side and a reused one counts as theft, so firing the call
   * twice with one cookie gets the second rejected and logs the user straight
   * back out of a session that was perfectly good.
   */
  async function bootstrap(): Promise<void> {
    if (ready.value) return;
    const run = (inFlight ??= (async () => {
      try {
        const session = await api.post<SessionResponse>('/api/auth/refresh');
        applySession(session);
      } catch {
        setAccessToken(null);
        user.value = null;
      } finally {
        ready.value = true;
        inFlight = null;
      }
    })());
    await run;
  }

  return { user, ready, isAuthenticated, isAdmin, login, logout, bootstrap };
});
