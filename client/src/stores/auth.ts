import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api, setAccessToken } from '@/lib/api';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  competitionId: string | null;
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
    }
  }

  /** On app boot, attempt a silent refresh from the httpOnly cookie. */
  async function bootstrap(): Promise<void> {
    try {
      const session = await api.post<SessionResponse>('/api/auth/refresh');
      applySession(session);
    } catch {
      setAccessToken(null);
      user.value = null;
    } finally {
      ready.value = true;
    }
  }

  return { user, ready, isAuthenticated, isAdmin, login, logout, bootstrap };
});
