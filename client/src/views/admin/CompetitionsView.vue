<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useToast } from 'primevue/usetoast';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import InputText from 'primevue/inputtext';
import Button from 'primevue/button';
import { api, ApiRequestError } from '@/lib/api';

interface Competition {
  id: string;
  name: string;
  participant_count: number;
  created_at: string;
}

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
    toast.add({ severity: 'error', summary: 'Hata', detail: msg(e), life: 4000 });
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
    toast.add({ severity: 'success', summary: 'Oluşturuldu', life: 2500 });
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
    <h1 style="margin: 0">Yarışmalar</h1>
    <form style="display: flex; gap: 0.5rem" @submit.prevent="create">
      <InputText v-model="newName" placeholder="Yeni yarışma adı" />
      <Button type="submit" label="Ekle" icon="pi pi-plus" :loading="saving" />
    </form>
    <DataTable :value="competitions" :loading="loading" data-key="id">
      <Column field="name" header="Ad" />
      <Column field="participant_count" header="Katılımcı" />
      <Column header="Oluşturulma">
        <template #body="{ data }">{{ new Date(data.created_at).toLocaleDateString('tr-TR') }}</template>
      </Column>
    </DataTable>
  </div>
</template>
