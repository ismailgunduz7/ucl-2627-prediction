import { ref, watch } from 'vue';

const STORAGE_KEY = 'ucl-theme';
type Theme = 'light' | 'dark';

function initialTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const theme = ref<Theme>(initialTheme());

function apply(t: Theme) {
  document.documentElement.classList.toggle('dark-mode', t === 'dark');
}
apply(theme.value);

watch(theme, (t) => {
  apply(t);
  localStorage.setItem(STORAGE_KEY, t);
});

/** App-wide light/dark theme, persisted and synced to the `.dark-mode` root class. */
export function useDarkMode() {
  const isDark = () => theme.value === 'dark';
  const toggle = () => {
    theme.value = theme.value === 'dark' ? 'light' : 'dark';
  };
  return { theme, isDark, toggle };
}
