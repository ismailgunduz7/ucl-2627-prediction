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
import Dialog from 'primevue/dialog';
import { api, ApiRequestError } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import PageHeader from '@/components/PageHeader.vue';

interface User { id: string; username: string; display_name: string; is_admin: boolean; competition_id: string | null }
interface Competition { id: string; name: string }

const toast = useToast();
const auth = useAuthStore();
const users = ref<User[]>([]);
const competitions = ref<Competition[]>([]);
const loading = ref(false);
const saving = ref(false);

const pwDialog = ref(false);
const pwTarget = ref<User | null>(null);
const pwValue = ref('');
const pwSaving = ref(false);
const delDialog = ref(false);
const delTarget = ref<User | null>(null);
const delSaving = ref(false);

const form = ref({ username: '', password: '', displayName: '', isAdmin: false, competitionId: null as string | null });
const canSubmit = computed(
  () => form.value.username.length >= 3 && form.value.password.length >= 8 && form.value.displayName.length >= 1 && (form.value.isAdmin || form.value.competitionId !== null),
);
const compName = (id: string | null) => (id ? competitions.value.find((c) => c.id === id)?.name ?? '—' : '—');

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
      username: form.value.username.trim(), password: form.value.password,
      displayName: form.value.displayName.trim(), isAdmin: form.value.isAdmin,
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
function openPassword(u: User) { pwTarget.value = u; pwValue.value = ''; pwDialog.value = true; }
async function submitPassword() {
  if (!pwTarget.value || pwValue.value.length < 8) return;
  pwSaving.value = true;
  try {
    await api.put(`/api/admin/users/${pwTarget.value.id}/password`, { password: pwValue.value });
    toast.add({ severity: 'success', summary: 'Şifre güncellendi', life: 2500 });
    pwDialog.value = false;
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Hata', detail: msg(e), life: 4000 });
  } finally {
    pwSaving.value = false;
  }
}
function openDelete(u: User) { delTarget.value = u; delDialog.value = true; }
async function submitDelete() {
  if (!delTarget.value) return;
  delSaving.value = true;
  try {
    await api.del(`/api/admin/users/${delTarget.value.id}`);
    toast.add({ severity: 'success', summary: 'Kullanıcı silindi', life: 2500 });
    delDialog.value = false;
    await load();
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Silinemedi', detail: msg(e), life: 4000 });
  } finally {
    delSaving.value = false;
  }
}
function msg(e: unknown) { return e instanceof ApiRequestError ? e.message : 'Beklenmeyen hata'; }
onMounted(load);
</script>

<template>
  <div class="page-stack">
    <PageHeader title="Kullanıcılar" subtitle="Hesapları sen oluşturuyorsun; kendi kendine kayıt yok." />

    <section class="surface-card card-pad">
      <div class="section-title">Yeni kullanıcı</div>
      <form class="form-grid" @submit.prevent="create">
        <div class="form-field">
          <label>Kullanıcı adı</label>
          <InputText v-model="form.username" autocomplete="off" />
        </div>
        <div class="form-field">
          <label>Görünen ad</label>
          <InputText v-model="form.displayName" />
        </div>
        <div class="form-field">
          <label>Şifre</label>
          <Password v-model="form.password" :feedback="false" toggle-mask autocomplete="new-password" />
        </div>
        <div v-if="!form.isAdmin" class="form-field">
          <label>Yarışma</label>
          <Select v-model="form.competitionId" :options="competitions" option-label="name" option-value="id" placeholder="Seç" />
        </div>
        <div class="form-field" style="justify-content: flex-end">
          <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer">
            <Checkbox v-model="form.isAdmin" :binary="true" /> Yönetici
          </label>
        </div>
        <div class="form-field" style="justify-content: flex-end">
          <Button type="submit" label="Oluştur" icon="pi pi-user-plus" :disabled="!canSubmit" :loading="saving" />
        </div>
      </form>
    </section>

    <section class="surface-card" style="overflow: hidden">
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
        <Column header="İşlemler">
          <template #body="{ data }">
            <div style="display: flex; gap: 0.25rem">
              <Button icon="pi pi-key" severity="secondary" text rounded title="Şifre değiştir" @click="openPassword(data)" />
              <Button icon="pi pi-trash" severity="danger" text rounded title="Sil" :disabled="data.id === auth.user?.id" @click="openDelete(data)" />
            </div>
          </template>
        </Column>
      </DataTable>
    </section>

    <Dialog v-model:visible="pwDialog" modal header="Şifre değiştir" :style="{ width: '380px' }">
      <p class="text-muted" style="margin: 0 0 0.75rem">
        <strong>{{ pwTarget?.display_name }}</strong> için yeni şifre. Açık oturumları kapanır.
      </p>
      <Password v-model="pwValue" :feedback="false" toggle-mask autocomplete="new-password" placeholder="Yeni şifre" />
      <template #footer>
        <Button label="Vazgeç" text @click="pwDialog = false" />
        <Button label="Kaydet" icon="pi pi-check" :disabled="pwValue.length < 8" :loading="pwSaving" @click="submitPassword" />
      </template>
    </Dialog>
    <Dialog v-model:visible="delDialog" modal header="Kullanıcıyı sil" :style="{ width: '380px' }">
      <p style="margin: 0">
        <strong>{{ delTarget?.display_name }}</strong> kalıcı olarak silinsin mi? Kadrosu ve puanları da gider.
      </p>
      <template #footer>
        <Button label="Vazgeç" text @click="delDialog = false" />
        <Button label="Sil" icon="pi pi-trash" severity="danger" :loading="delSaving" @click="submitDelete" />
      </template>
    </Dialog>
  </div>
</template>
