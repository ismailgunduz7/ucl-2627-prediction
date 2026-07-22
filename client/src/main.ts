import { createApp } from 'vue';
import { createPinia } from 'pinia';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import ConfirmationService from 'primevue/confirmationservice';
import 'primeicons/primeicons.css';

import { AppPreset } from './theme/preset';
import App from './App.vue';
import { router } from './router';
import './styles/main.css';

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
    emptyMessage: 'Kayıt bulunamadı',
    emptyFilterMessage: 'Sonuç bulunamadı',
  },
});
app.use(ToastService);
app.use(ConfirmationService);
app.use(router);

app.mount('#app');
