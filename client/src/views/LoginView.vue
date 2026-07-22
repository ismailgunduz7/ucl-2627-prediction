<script setup lang="ts">
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import Card from 'primevue/card';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import Button from 'primevue/button';
import Message from 'primevue/message';
import { useAuthStore } from '@/stores/auth';
import { ApiRequestError } from '@/lib/api';

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
    error.value = e instanceof ApiRequestError ? e.message : 'Giriş yapılamadı, tekrar dene';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <span class="emoji">⭐️</span>
        <h1 style="margin: 0; color: #fff; font-size: 1.5rem">Şampiyonlar Ligi Fantazi</h1>
        <p style="margin: 0.35rem 0 0; color: #c7d2fe">2026/27 sezonu · giriş yap</p>
      </div>
      <Card>
        <template #content>
          <form class="page-stack" style="gap: 1rem" @submit.prevent="submit">
            <div class="form-field">
              <label for="username">Kullanıcı adı</label>
              <InputText id="username" v-model="username" autocomplete="username" required autofocus />
            </div>
            <div class="form-field">
              <label for="password">Şifre</label>
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
            <Button type="submit" label="Giriş yap" :loading="loading" size="large" />
          </form>
        </template>
      </Card>
    </div>
  </div>
</template>
