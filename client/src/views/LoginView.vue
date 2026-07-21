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
    error.value = e instanceof ApiRequestError ? e.message : 'Giriş başarısız';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="center-screen">
    <Card class="card-narrow">
      <template #title>Şampiyonlar Ligi Fantazi</template>
      <template #subtitle>2026–27 · Giriş</template>
      <template #content>
        <form class="stack" @submit.prevent="submit">
          <div class="field">
            <label for="username">Kullanıcı adı</label>
            <InputText id="username" v-model="username" autocomplete="username" required />
          </div>
          <div class="field">
            <label for="password">Şifre</label>
            <Password
              id="password"
              v-model="password"
              :feedback="false"
              toggle-mask
              input-id="password"
              autocomplete="current-password"
              required
            />
          </div>
          <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
          <Button type="submit" label="Giriş yap" :loading="loading" />
        </form>
      </template>
    </Card>
  </div>
</template>
