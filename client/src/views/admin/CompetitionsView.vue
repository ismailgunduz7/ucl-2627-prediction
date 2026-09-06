<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'primevue/usetoast';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import InputText from 'primevue/inputtext';
import Button from 'primevue/button';
import { Plus } from '@lucide/vue';
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
      </DataTable>
    </section>
  </div>
</template>
