<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'primevue/usetoast';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import InputText from 'primevue/inputtext';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import { Plus, Pencil, Trash2, Check } from '@lucide/vue';
import { api, ApiRequestError } from '@/lib/api';
import PageHeader from '@/components/PageHeader.vue';
import { formatDateOnly } from '@/lib/format';

interface Competition { id: string; name: string; participant_count: number; created_at: string }

const { t } = useI18n();
const toast = useToast();
const competitions = ref<Competition[]>([]);
const loading = ref(false);
const newName = ref('');
const saving = ref(false);

const editDialog = ref(false);
const editTarget = ref<Competition | null>(null);
const editName = ref('');
const editSaving = ref(false);

const delDialog = ref(false);
const delTarget = ref<Competition | null>(null);
const delSaving = ref(false);

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ competitions: Competition[] }>('/api/admin/competitions');
    competitions.value = res.competitions;
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.competitions.loadFailed'), detail: msg(e), life: 4000 });
  } finally {
    loading.value = false;
  }
}
async function create() {
  if (!newName.value.trim()) return;
  saving.value = true;
  try {
    await api.post('/api/admin/competitions', { name: newName.value.trim() });
    newName.value = '';
    toast.add({ severity: 'success', summary: t('admin.competitions.added'), life: 2500 });
    await load();
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.competitions.addFailed'), detail: msg(e), life: 4000 });
  } finally {
    saving.value = false;
  }
}

function openEdit(c: Competition) {
  editTarget.value = c;
  editName.value = c.name;
  editDialog.value = true;
}
async function submitEdit() {
  const target = editTarget.value;
  if (!target || !editName.value.trim()) return;
  editSaving.value = true;
  try {
    await api.put(`/api/admin/competitions/${target.id}`, { name: editName.value.trim() });
    editDialog.value = false;
    toast.add({ severity: 'success', summary: t('admin.competitions.renamed'), life: 2500 });
    await load();
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.competitions.renameFailed'), detail: msg(e), life: 4000 });
  } finally {
    editSaving.value = false;
  }
}

function openDelete(c: Competition) {
  delTarget.value = c;
  delDialog.value = true;
}
async function submitDelete() {
  const target = delTarget.value;
  if (!target) return;
  delSaving.value = true;
  try {
    await api.del(`/api/admin/competitions/${target.id}`);
    delDialog.value = false;
    toast.add({ severity: 'success', summary: t('admin.competitions.deleted'), life: 2500 });
    await load();
  } catch (e) {
    // The API refuses while anybody is still in it, and says how many.
    toast.add({ severity: 'error', summary: t('admin.competitions.deleteFailed'), detail: msg(e), life: 5000 });
  } finally {
    delSaving.value = false;
  }
}

function msg(e: unknown) { return e instanceof ApiRequestError ? e.message : t('common.unexpectedError'); }
onMounted(load);
</script>

<template>
  <div class="page-stack">
    <PageHeader :title="$t('nav.admin.competitions')" :subtitle="$t('admin.competitions.subtitle')" />

    <section class="surface-card card-pad">
      <form style="display: flex; gap: 0.6rem; flex-wrap: wrap" @submit.prevent="create">
        <InputText
          v-model="newName"
          :placeholder="$t('admin.competitions.namePlaceholder')"
          style="flex: 1; min-width: 200px"
        />
        <Button type="submit" :label="$t('common.add')" :loading="saving">
          <template #icon><Plus :size="16" /></template>
        </Button>
      </form>
    </section>

    <section class="surface-card table-scroll">
      <DataTable :value="competitions" :loading="loading" data-key="id">
        <Column field="name" :header="$t('admin.competitions.name')" />
        <Column field="participant_count" :header="$t('admin.competitions.participants')" />
        <Column :header="$t('admin.competitions.createdAt')">
          <template #body="{ data }">{{ formatDateOnly(data.created_at) }}</template>
        </Column>
        <Column :header="$t('admin.competitions.actions')">
          <template #body="{ data }">
            <div style="display: flex; gap: 0.25rem">
              <Button
                severity="secondary"
                text
                rounded
                :aria-label="$t('admin.competitions.editName', { name: data.name })"
                :title="$t('admin.competitions.editTitle')"
                @click="openEdit(data)"
              >
                <template #icon><Pencil :size="17" /></template>
              </Button>
              <Button
                severity="danger"
                text
                rounded
                :aria-label="$t('admin.competitions.deleteCompetition', { name: data.name })"
                :title="Number(data.participant_count) > 0
                  ? $t('admin.competitions.inUse')
                  : $t('common.delete')"
                :disabled="Number(data.participant_count) > 0"
                @click="openDelete(data)"
              >
                <template #icon><Trash2 :size="17" /></template>
              </Button>
            </div>
          </template>
        </Column>
      </DataTable>
    </section>

    <Dialog v-model:visible="editDialog" modal :header="$t('admin.competitions.editTitle')" :style="{ width: '380px' }">
      <div class="form-field">
        <label>{{ $t('admin.competitions.name') }}</label>
        <InputText v-model="editName" autofocus @keyup.enter="submitEdit" />
      </div>
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="editDialog = false" />
        <Button
          :label="$t('common.save')"
          :loading="editSaving"
          :disabled="!editName.trim()"
          @click="submitEdit"
        >
          <template #icon><Check :size="16" /></template>
        </Button>
      </template>
    </Dialog>

    <Dialog v-model:visible="delDialog" modal :header="$t('admin.competitions.deleteTitle')" :style="{ width: '380px' }">
      <i18n-t keypath="admin.competitions.deleteBody" tag="p" style="margin: 0" scope="global">
        <template #name><strong>{{ delTarget?.name }}</strong></template>
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
