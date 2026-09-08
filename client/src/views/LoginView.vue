<script setup lang="ts">
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import Card from 'primevue/card';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import Button from 'primevue/button';
import Message from 'primevue/message';
import StarBall from '@/components/StarBall.vue';
import LanguagePicker from '@/components/LanguagePicker.vue';
import { useAuthStore } from '@/stores/auth';
import { ApiRequestError } from '@/lib/api';

const { t } = useI18n();
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const username = ref('');
const password = ref('');
const error = ref<string | null>(null);
const loading = ref(false);

async function submit() {
  error.value = null;
  loading.value = true;
  try {
    await auth.login(username.value.trim(), password.value);
    const redirect = (route.query.redirect as string) || (auth.isAdmin ? '/yonetim' : '/');
    await router.replace(redirect);
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : t('auth.loginFailed');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <StarBall class="login-mark" />
        <h1 class="login-title">{{ $t('auth.title') }}</h1>
        <p class="login-season">{{ $t('auth.season') }}</p>
      </div>
      <Card>
        <template #content>
          <form class="page-stack login-form" @submit.prevent="submit">
            <div class="form-field">
              <label for="username">{{ $t('auth.username') }}</label>
              <InputText id="username" v-model="username" autocomplete="username" required autofocus />
            </div>
            <div class="form-field">
              <label for="password">{{ $t('auth.password') }}</label>
              <Password
                v-model="password"
                input-id="password"
                :feedback="false"
                toggle-mask
                autocomplete="current-password"
                required
              />
            </div>
            <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
            <Button type="submit" :label="$t('auth.signIn')" :loading="loading" size="large" />
          </form>
        </template>
      </Card>
      <div class="login-lang"><LanguagePicker /></div>
    </div>
  </div>
</template>

<style scoped>
.login-lang { display: flex; justify-content: center; margin-top: 1rem; }

.login-form { gap: 1rem; }
</style>
