<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useI18n } from 'vue-i18n';
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
import { Zap, KeyRound, Trash2, Check } from '@lucide/vue';
import { api, ApiRequestError } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { JOKER_CODES } from '@/lib/jokers';
import PageHeader from '@/components/PageHeader.vue';
import JokerIcon from '@/components/JokerIcon.vue';

interface User { id: string; username: string; display_name: string; is_admin: boolean; competition_id: string | null }
interface Competition { id: string; name: string }

const { t } = useI18n();
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
    toast.add({ severity: 'error', summary: t('admin.users.loadFailed'), detail: msg(e), life: 4000 });
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
    toast.add({ severity: 'success', summary: t('admin.users.created'), life: 2500 });
    form.value = { username: '', password: '', displayName: '', isAdmin: false, competitionId: null };
    await load();
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.users.createFailed'), detail: msg(e), life: 4000 });
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
    toast.add({ severity: 'success', summary: t('admin.users.passwordSaved'), life: 2500 });
    pwDialog.value = false;
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.users.passwordFailed'), detail: msg(e), life: 4000 });
  } finally {
    pwSaving.value = false;
  }
}
// Joker inventory repair: read the live counts, let the admin overwrite them.
const jokerDialog = ref(false);
const jokerTarget = ref<User | null>(null);
const jokerCounts = ref<Record<string, number>>({});
const jokerSaving = ref(false);

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
    toast.add({ severity: 'error', summary: t('admin.users.jokersLoadFailed'), detail: msg(e), life: 4000 });
  }
}
async function submitJokers() {
  if (!jokerTarget.value) return;
  jokerSaving.value = true;
  try {
    await api.put(`/api/admin/users/${jokerTarget.value.id}/jokers`, { counts: jokerCounts.value });
    toast.add({ severity: 'success', summary: t('admin.users.jokersSaved'), life: 2500 });
    jokerDialog.value = false;
  } catch (e) {
    toast.add({ severity: 'error', summary: t('common.saveFailed'), detail: msg(e), life: 4000 });
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
    toast.add({ severity: 'success', summary: t('admin.users.deleted'), life: 2500 });
    delDialog.value = false;
    await load();
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.users.deleteFailed'), detail: msg(e), life: 4000 });
  } finally {
    delSaving.value = false;
  }
}
function msg(e: unknown) { return e instanceof ApiRequestError ? e.message : t('common.unexpectedError'); }
onMounted(load);
</script>

<template>
  <div class="page-stack">
    <PageHeader :title="$t('nav.admin.users')" />

    <section class="surface-card card-pad">
      <div class="section-title">{{ $t('admin.users.newUser') }}</div>
      <form @submit.prevent="create">
        <div class="form-grid">
          <div class="form-field">
            <label>{{ $t('auth.username') }}</label>
            <InputText v-model="form.username" autocomplete="off" />
          </div>
          <div class="form-field">
            <label>{{ $t('admin.users.displayName') }}</label>
            <InputText v-model="form.displayName" />
          </div>
          <div class="form-field">
            <label>{{ $t('auth.password') }}</label>
            <Password v-model="form.password" :feedback="false" toggle-mask autocomplete="new-password" />
          </div>
          <!-- Always rendered (disabled for admins) so the grid never reflows. -->
          <div class="form-field">
            <label>{{ $t('nav.admin.competitions') }}</label>
            <Select
              v-model="form.competitionId"
              :options="competitions"
              option-label="name"
              option-value="id"
              :placeholder="$t('admin.users.choose')"
              :disabled="form.isAdmin"
            />
          </div>
          <div class="form-field">
            <label>{{ $t('admin.users.role') }}</label>
            <label class="check-control">
              <Checkbox v-model="form.isAdmin" :binary="true" input-id="isAdmin" />
              <span>{{ $t('admin.users.admin') }}</span>
            </label>
          </div>
        </div>
        <div class="form-actions">
          <Button type="submit" :label="$t('admin.users.create')" :disabled="!canSubmit" :loading="saving" />
        </div>
      </form>
    </section>

    <section class="surface-card table-scroll">
      <DataTable :value="users" :loading="loading" data-key="id">
        <Column field="display_name" :header="$t('admin.users.displayName')" />
        <Column field="username" :header="$t('auth.username')" />
        <Column :header="$t('admin.users.role')">
          <template #body="{ data }">
            <Tag
              :severity="data.is_admin ? 'warn' : 'info'"
              :value="data.is_admin ? $t('admin.users.admin') : $t('admin.users.participant')"
            />
          </template>
        </Column>
        <Column :header="$t('nav.admin.competitions')">
          <template #body="{ data }">{{ compName(data.competition_id) }}</template>
        </Column>
        <Column :header="$t('admin.users.actions')">
          <template #body="{ data }">
            <div style="display: flex; gap: 0.25rem">
              <Button
                v-if="!data.is_admin"
                severity="secondary"
                text
                rounded
                :aria-label="$t('admin.users.editJokers', { name: data.display_name })"
                :title="$t('admin.users.jokersTitle')"
                @click="openJokers(data)"
              >
                <template #icon><Zap :size="17" /></template>
              </Button>
              <Button
                severity="secondary"
                text
                rounded
                :aria-label="$t('admin.users.changePassword', { name: data.display_name })"
                :title="$t('admin.users.passwordTitle')"
                @click="openPassword(data)"
              >
                <template #icon><KeyRound :size="17" /></template>
              </Button>
              <Button
                severity="danger"
                text
                rounded
                :aria-label="$t('admin.users.deleteAccount', { name: data.display_name })"
                :title="$t('common.delete')"
                :disabled="data.id === auth.user?.id"
                @click="openDelete(data)"
              >
                <template #icon><Trash2 :size="17" /></template>
              </Button>
            </div>
          </template>
        </Column>
      </DataTable>
    </section>

    <Dialog v-model:visible="pwDialog" modal :header="$t('admin.users.passwordTitle')" :style="{ width: '380px' }">
      <i18n-t keypath="admin.users.passwordBody" tag="p" class="text-muted" style="margin: 0 0 0.75rem" scope="global">
        <template #name><strong>{{ pwTarget?.display_name }}</strong></template>
      </i18n-t>
      <Password
        v-model="pwValue"
        :feedback="false"
        toggle-mask
        autocomplete="new-password"
        :placeholder="$t('admin.users.newPassword')"
      />
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="pwDialog = false" />
        <Button :label="$t('common.save')" :disabled="pwValue.length < 1" :loading="pwSaving" @click="submitPassword">
          <template #icon><Check :size="16" /></template>
        </Button>
      </template>
    </Dialog>
    <Dialog v-model:visible="jokerDialog" modal :header="$t('admin.users.jokersTitle')" :style="{ width: '400px' }">
      <i18n-t keypath="admin.users.jokersBody" tag="p" class="text-muted" style="margin: 0 0 0.9rem" scope="global">
        <template #name><strong>{{ jokerTarget?.display_name }}</strong></template>
      </i18n-t>
      <div class="joker-rows">
        <label v-for="code in JOKER_CODES" :key="code" class="joker-row">
          <span class="joker-row-name"><JokerIcon :code="code" :size="16" /> {{ $t(`joker.${code}`) }}</span>
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
        <Button :label="$t('common.cancel')" text @click="jokerDialog = false" />
        <Button :label="$t('common.save')" :loading="jokerSaving" @click="submitJokers">
          <template #icon><Check :size="16" /></template>
        </Button>
      </template>
    </Dialog>
    <Dialog v-model:visible="delDialog" modal :header="$t('admin.users.deleteTitle')" :style="{ width: '380px' }">
      <i18n-t keypath="admin.users.deleteBody" tag="p" style="margin: 0" scope="global">
        <template #name><strong>{{ delTarget?.display_name }}</strong></template>
      </i18n-t>
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="delDialog = false" />
        <Button :label="$t('common.delete')" severity="danger" :loading="delSaving" @click="submitDelete">
          <template #icon><Trash2 :size="16" /></template>
        </Button>
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
