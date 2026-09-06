import { createApp } from 'vue';
import { createPinia } from 'pinia';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import ConfirmationService from 'primevue/confirmationservice';
import { MotionPlugin } from '@vueuse/motion';

import { AppPreset } from './theme/preset';
import App from './App.vue';
import { router } from './router';
import './styles/main.css';

// The app is dark-only; the class is always present so PrimeVue uses its dark tokens.
document.documentElement.classList.add('dark-mode');
localStorage.setItem('nl-hud:public:v1', 'true');

const app = createApp(App);

app.use(createPinia());
app.use(PrimeVue, {
  theme: {
    preset: AppPreset,
    options: { darkModeSelector: '.dark-mode' },
  },
  locale: {
    accept: 'Tamam',
    reject: 'İptal',
    choose: 'Seç',
    cancel: 'Vazgeç',
    emptyMessage: 'Kayıt yok',
    emptyFilterMessage: 'Sonuç yok',
  },
});
app.use(ToastService);
app.use(ConfirmationService);
app.use(MotionPlugin);
app.use(router);

app.mount('#app');
