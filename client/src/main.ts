import { createApp, watch } from 'vue';
import { createPinia } from 'pinia';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import ConfirmationService from 'primevue/confirmationservice';
import { MotionPlugin } from '@vueuse/motion';

import { AppPreset } from './theme/preset';
import { i18n, type Locale } from './i18n';
import { primeVueLocale } from './i18n/primevue';
import { useLocaleStore } from './stores/locale';
import App from './App.vue';
import { router } from './router';
import './styles/main.css';

// The app is dark-only; the class is always present so PrimeVue uses its dark tokens.
document.documentElement.classList.add('dark-mode');
localStorage.setItem('nl-hud:public:v1', 'true');

const app = createApp(App);

const pinia = createPinia();
app.use(pinia);
app.use(PrimeVue, {
  theme: {
    preset: AppPreset,
    options: { darkModeSelector: '.dark-mode' },
  },
  locale: primeVueLocale(i18n.global.locale.value as Locale),
});
app.use(i18n);
app.use(ToastService);
app.use(ConfirmationService);
app.use(MotionPlugin);
app.use(router);

// PrimeVue keeps its own copy of the strings on its buttons and empty tables.
watch(
  () => i18n.global.locale.value,
  (locale) => {
    const current = app.config.globalProperties.$primevue?.config.locale;
    if (current) Object.assign(current, primeVueLocale(locale as Locale));
  },
);

// The browser's own memory before the first paint; the account overrides it as
// soon as the session comes back (see stores/auth.ts).
useLocaleStore(pinia).bootstrap();

app.mount('#app');
