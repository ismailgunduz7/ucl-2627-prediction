<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useToast } from 'primevue/usetoast';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { api, ApiRequestError } from '@/lib/api';

interface User {
  id: string;
  username: string;
  display_name: string;
  is_admin: boolean;
  competition_id: string | null;
  created_at: string;
}
interface Competition {
  id: string;
  name: string;
}

const toast = useToast();
const users = ref<User[]>([]);
const competitions = ref<Competition[]>([]);
const loading = ref(false);
const saving = ref(false);

const form = ref({
  username: '',
  password: '',
  displayName: '',
  isAdmin: false,
  competitionId: null as string | null,
});

const canSubmit = computed(
  () =>
    form.value.username.length >= 3 &&
    form.value.password.length >= 8 &&
    form.value.displayName.length >= 1 &&
    (form.value.isAdmin || form.value.competitionId !== null),
);

const compName = (id: string | null) =>
  id ? (competitions.value.find((c) => c.id === id)?.name ?? '—') : '—';

async function load() {
  loading.value = true;
  try {
    const [u, c] = await Promise.all([
      api.get<{ users: User[] }>('/api/admin/users'),
      api.get<{ competitions: Competition[] }>('/api/admin/competitions'),
    ]);
    users.value = u.users;
    competitions.value = c.competitions;
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Hata', detail: msg(e), life: 4000 });
  } finally {
    loading.value = false;
  }
}

async function create() {
  if (!canSubmit.value) return;
  saving.value = true;
  try {
    await api.post('/api/admin/users', {
      username: form.value.username.trim(),
      password: form.value.password,
      displayName: form.value.displayName.trim(),
      isAdmin: form.value.isAdmin,
      competitionId: form.value.isAdmin ? null : form.value.competitionId,
    });
    toast.add({ severity: 'success', summary: 'Kullanıcı oluşturuldu', life: 2500 });
    form.value = { username: '', password: '', displayName: '', isAdmin: false, competitionId: null };
    await load();
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Hata', detail: msg(e), life: 4000 });
  } finally {
    saving.value = false;
  }
}

function msg(e: unknown) {
  return e instanceof ApiRequestError ? e.message : 'Beklenmeyen hata';
}

onMounted(load);
</script>

<template>
  <div class="stack">
    <h1 style="margin: 0">Kullanıcılar</h1>

    <form
      class="stack"
      style="background: #fff; padding: 1rem; border-radius: 8px; max-width: 480px"
      @submit.prevent="create"
    >
      <strong>Yeni kullanıcı</strong>
      <div class="field">
        <label>Kullanıcı adı (min 3)</label>
        <InputText v-model="form.username" autocomplete="off" />
      </div>
      <div class="field">
        <label>Görünen ad</label>
        <InputText v-model="form.displayName" />
      </div>
      <div class="field">
        <label>Şifre (min 8)</label>
        <Password v-model="form.password" :feedback="false" toggle-mask autocomplete="new-password" />
      </div>
      <div style="display: flex; align-items: center; gap: 0.5rem">
        <Checkbox v-model="form.isAdmin" input-id="isAdmin" :binary="true" />
        <label for="isAdmin">Yönetici</label>
      </div>
      <div v-if="!form.isAdmin" class="field">
        <label>Yarışma</label>
        <Select
          v-model="form.competitionId"
          :options="competitions"
          option-label="name"
          option-value="id"
          placeholder="Yarışma seçin"
        />
      </div>
      <Button type="submit" label="Oluştur" icon="pi pi-user-plus" :disabled="!canSubmit" :loading="saving" />
    </form>

    <DataTable :value="users" :loading="loading" data-key="id">
      <Column field="display_name" header="Ad" />
      <Column field="username" header="Kullanıcı adı" />
      <Column header="Rol">
        <template #body="{ data }">
          <Tag :severity="data.is_admin ? 'warn' : 'info'" :value="data.is_admin ? 'Yönetici' : 'Katılımcı'" />
        </template>
      </Column>
      <Column header="Yarışma">
        <template #body="{ data }">{{ compName(data.competition_id) }}</template>
      </Column>
    </DataTable>
  </div>
</template>
