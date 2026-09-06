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
import InputNumber from 'primevue/inputnumber';
import { api, ApiRequestError } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { JOKER_NAMES } from '@/lib/jokers';
import PageHeader from '@/components/PageHeader.vue';
import JokerIcon from '@/components/JokerIcon.vue';

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
  () => form.value.username.length >= 3 && form.value.password.length >= 1 && form.value.displayName.length >= 1 && (form.value.isAdmin || form.value.competitionId !== null),
);
const compName = (id: string | null) => (id ? competitions.value.find((c) => c.id === id)?.name ?? '-' : '-');

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
    toast.add({ severity: 'error', summary: 'Liste yüklenemedi', detail: msg(e), life: 4000 });
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
    toast.add({ severity: 'error', summary: 'Kullanıcı oluşturulamadı', detail: msg(e), life: 4000 });
  } finally {
    saving.value = false;
  }
}
function openPassword(u: User) { pwTarget.value = u; pwValue.value = ''; pwDialog.value = true; }
async function submitPassword() {
  if (!pwTarget.value || pwValue.value.length < 1) return;
  pwSaving.value = true;
  try {
    await api.put(`/api/admin/users/${pwTarget.value.id}/password`, { password: pwValue.value });
    toast.add({ severity: 'success', summary: 'Şifre güncellendi', life: 2500 });
    pwDialog.value = false;
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Şifre güncellenemedi', detail: msg(e), life: 4000 });
  } finally {
    pwSaving.value = false;
  }
}
// Joker inventory repair: read the live counts, let the admin overwrite them.
const jokerDialog = ref(false);
const jokerTarget = ref<User | null>(null);
const jokerCounts = ref<Record<string, number>>({});
const jokerSaving = ref(false);
const JOKER_CODES = ['weekly_swap', 'triple_boost', 'clean_sheet_shield', 'bench_boost'];

async function openJokers(u: User) {
  jokerTarget.value = u;
  jokerCounts.value = {};
  jokerDialog.value = true;
  try {
    const res = await api.get<{ inventory: { code: string; remaining: number }[] }>(
      `/api/admin/users/${u.id}/jokers`,
    );
    jokerCounts.value = Object.fromEntries(res.inventory.map((i) => [i.code, i.remaining]));
  } catch (e) {
    jokerDialog.value = false;
    toast.add({ severity: 'error', summary: 'Joker hakları okunamadı', detail: msg(e), life: 4000 });
  }
}
async function submitJokers() {
  if (!jokerTarget.value) return;
  jokerSaving.value = true;
  try {
    await api.put(`/api/admin/users/${jokerTarget.value.id}/jokers`, { counts: jokerCounts.value });
    toast.add({ severity: 'success', summary: 'Joker hakları güncellendi', life: 2500 });
    jokerDialog.value = false;
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Kaydedilemedi', detail: msg(e), life: 4000 });
  } finally {
    jokerSaving.value = false;
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
    <PageHeader title="Kullanıcılar" />

    <section class="surface-card card-pad">
      <div class="section-title">Yeni kullanıcı</div>
      <form @submit.prevent="create">
        <div class="form-grid">
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
          <!-- Always rendered (disabled for admins) so the grid never reflows. -->
          <div class="form-field">
            <label>Yarışma</label>
            <Select
              v-model="form.competitionId"
              :options="competitions"
              option-label="name"
              option-value="id"
              placeholder="Seç"
              :disabled="form.isAdmin"
            />
          </div>
          <div class="form-field">
            <label>Rol</label>
            <label class="check-control">
              <Checkbox v-model="form.isAdmin" :binary="true" input-id="isAdmin" />
              <span>Yönetici</span>
            </label>
          </div>
        </div>
        <div class="form-actions">
          <Button type="submit" label="Oluştur" :disabled="!canSubmit" :loading="saving" />
        </div>
      </form>
    </section>

    <section class="surface-card table-scroll">
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
              <Button
                v-if="!data.is_admin"
                icon="pi pi-bolt"
                severity="secondary"
                text
                rounded
                :aria-label="`${data.display_name} joker haklarını düzenle`"
                title="Joker hakları"
                @click="openJokers(data)"
              />
              <Button
                icon="pi pi-key"
                severity="secondary"
                text
                rounded
                :aria-label="`${data.display_name} şifresini değiştir`"
                title="Şifre değiştir"
                @click="openPassword(data)"
              />
              <Button
                icon="pi pi-trash"
                severity="danger"
                text
                rounded
                :aria-label="`${data.display_name} hesabını sil`"
                title="Sil"
                :disabled="data.id === auth.user?.id"
                @click="openDelete(data)"
              />
            </div>
          </template>
        </Column>
      </DataTable>
    </section>

    <Dialog v-model:visible="pwDialog" modal header="Şifre değiştir" :style="{ width: '380px' }">
      <p class="text-muted" style="margin: 0 0 0.75rem">
        <strong>{{ pwTarget?.display_name }}</strong> için yeni şifre. Açık oturumları kapanır ve
        yeniden giriş yapması gerekir.
      </p>
      <Password v-model="pwValue" :feedback="false" toggle-mask autocomplete="new-password" placeholder="Yeni şifre" />
      <template #footer>
        <Button label="Vazgeç" text @click="pwDialog = false" />
        <Button label="Kaydet" icon="pi pi-check" :disabled="pwValue.length < 1" :loading="pwSaving" @click="submitPassword" />
      </template>
    </Dialog>
    <Dialog v-model:visible="jokerDialog" modal header="Joker hakları" :style="{ width: '400px' }">
      <p class="text-muted" style="margin: 0 0 0.9rem">
        <strong>{{ jokerTarget?.display_name }}</strong> için kalan hakları doğrudan yaz. Daha önce
        oynadığı jokerler olduğu gibi kalır.
      </p>
      <div class="joker-rows">
        <label v-for="code in JOKER_CODES" :key="code" class="joker-row">
          <span class="joker-row-name"><JokerIcon :code="code" :size="16" /> {{ JOKER_NAMES[code] }}</span>
          <InputNumber
            v-model="jokerCounts[code]"
            :min="0"
            :max="99"
            :use-grouping="false"
            show-buttons
            button-layout="horizontal"
            :input-style="{ width: '2.8rem', textAlign: 'center' }"
            decrement-button-class="p-button-secondary"
            increment-button-class="p-button-secondary"
          />
        </label>
      </div>
      <template #footer>
        <Button label="Vazgeç" text @click="jokerDialog = false" />
        <Button label="Kaydet" icon="pi pi-check" :loading="jokerSaving" @click="submitJokers" />
      </template>
    </Dialog>
    <Dialog v-model:visible="delDialog" modal header="Kullanıcıyı sil" :style="{ width: '380px' }">
      <p style="margin: 0">
        <strong>{{ delTarget?.display_name }}</strong> silinsin mi? Kadrosu ve topladığı puanlar da
        gider, geri getirmenin yolu yok.
      </p>
      <template #footer>
        <Button label="Vazgeç" text @click="delDialog = false" />
        <Button label="Sil" icon="pi pi-trash" severity="danger" :loading="delSaving" @click="submitDelete" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
/* Checkbox sits in a control box the same height as the inputs beside it. */
.check-control {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-height: 42px;
  padding: 0 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 600;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 1rem;
}
.joker-rows { display: flex; flex-direction: column; gap: 0.6rem; }
.joker-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.joker-row-name { display: inline-flex; align-items: center; gap: 0.5rem; font-weight: 600; font-size: 0.92rem; }
</style>
