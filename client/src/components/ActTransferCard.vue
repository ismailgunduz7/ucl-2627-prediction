<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import Select from 'primevue/select';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import Message from 'primevue/message';
import Tag from 'primevue/tag';
import { useToast } from 'primevue/usetoast';
import { api, ApiRequestError } from '@/lib/api';
import { jokerName } from '@/lib/jokers';

interface Option { fromTeamId: string; fromName: string; candidates: { id: string; name: string }[] }
interface State {
  status: 'available' | 'committed' | 'expired' | 'unavailable';
  fromTeamId: string | null;
  toTeamId: string | null;
  locked: boolean;
  options: Option[];
}

const emit = defineEmits<{ changed: [] }>();
const toast = useToast();

const state = ref<State | null>(null);
const fromId = ref<string | null>(null);
const toId = ref<string | null>(null);
const saving = ref(false);

const show = computed(() => state.value && state.value.status !== 'unavailable');
const editable = computed(() => !!state.value && !state.value.locked && state.value.status !== 'expired');
const candidates = computed(
  () => state.value?.options.find((o) => o.fromTeamId === fromId.value)?.candidates ?? [],
);
const committedNames = computed(() => {
  const s = state.value;
  if (!s || s.status !== 'committed') return null;
  const from = s.options.find((o) => o.fromTeamId === s.fromTeamId)?.fromName;
  return { from: from ?? 'kulüp', toId: s.toTeamId };
});

async function load() {
  state.value = await api.get<State>('/api/act-transfer');
  fromId.value = state.value.fromTeamId;
  toId.value = state.value.toTeamId;
}

// A club the transfer removes may carry an active joker; the server answers
// 409 and asks for a confirmation before cancelling and refunding it.
const jokerConflict = ref<{ teamName: string; jokerName: string } | null>(null);

function conflictText(e: ApiRequestError): { teamName: string; jokerName: string } {
  const details = e.details as { conflicts?: { code: string; teamId: string }[] } | undefined;
  const first = details?.conflicts?.[0];
  const names = new Map<string, string>();
  for (const o of state.value?.options ?? []) {
    names.set(o.fromTeamId, o.fromName);
    for (const c of o.candidates) names.set(c.id, c.name);
  }
  return {
    teamName: (first && names.get(first.teamId)) ?? 'bu kulüp',
    jokerName: jokerName(first?.code) || 'joker',
  };
}

async function submit(cancelJokers = false) {
  if (!fromId.value || !toId.value) return;
  saving.value = true;
  try {
    state.value = await api.put<State>('/api/act-transfer', {
      fromTeamId: fromId.value,
      toTeamId: toId.value,
      cancelJokers,
    });
    toast.add({ severity: 'success', summary: 'Transfer uygulandı', life: 2500 });
    emit('changed');
  } catch (e) {
    if (e instanceof ApiRequestError && e.code === 'joker_squad_conflict') {
      jokerConflict.value = conflictText(e);
    } else {
      toast.add({
        severity: 'error',
        summary: 'Olmadı',
        detail: e instanceof ApiRequestError ? e.message : 'Beklenmeyen hata',
        life: 4500,
      });
    }
  } finally {
    saving.value = false;
  }
}

async function confirmJokerCancel() {
  jokerConflict.value = null;
  await submit(true);
}

onMounted(load);
</script>

<template>
  <section v-if="show" class="surface-card card-pad">
    <div class="head">
      <div>
        <div class="section-title" style="margin: 0">Eleme turu transferi</div>
        <p class="text-muted" style="margin: 0.25rem 0 0; font-size: 0.88rem">
          Eleme turlarına girerken bir kulübünü aynı pottan biriyle kalıcı olarak değiştirebilirsin.
          Kullanmak zorunda değilsin.
        </p>
      </div>
      <Tag
        :severity="state!.status === 'committed' ? 'success' : state!.status === 'expired' ? 'danger' : 'info'"
        :value="state!.status === 'committed' ? 'kullanıldı' : state!.status === 'expired' ? 'süresi doldu' : 'hakkın var'"
      />
    </div>

    <Message v-if="state!.status === 'expired'" severity="secondary" :closable="false">
      Transfer penceresi kapandı, kadron sabit.
    </Message>
    <Message v-else-if="state!.locked" severity="warn" :closable="false">
      Eleme turu başladı, transfer artık değiştirilemez.
    </Message>

    <template v-if="editable">
      <div class="row">
        <div class="form-field">
          <label>Çıkacak kulüp</label>
          <Select
            v-model="fromId"
            :options="state!.options"
            option-label="fromName"
            option-value="fromTeamId"
            placeholder="Kadrondan seç"
            @change="toId = null"
          />
        </div>
        <div class="form-field">
          <label>Gelecek kulüp</label>
          <Select
            v-model="toId"
            :options="candidates"
            option-label="name"
            option-value="id"
            :disabled="!fromId"
            placeholder="Aynı pottan seç"
          />
        </div>
        <Button
          :label="state!.status === 'committed' ? 'Transferi değiştir' : 'Transferi uygula'"
          :disabled="!fromId || !toId"
          :loading="saving"
          @click="submit()"
        />
      </div>
      <p v-if="committedNames" class="text-muted" style="margin: 0.75rem 0 0; font-size: 0.85rem">
        Şu an <strong>{{ committedNames.from }}</strong> yerine yeni kulübün kadronda. Pencere
        kapanana kadar değiştirebilirsin.
      </p>
    </template>

    <Dialog
      :visible="jokerConflict !== null"
      modal
      header="Joker çakışması"
      :style="{ width: '400px' }"
      @update:visible="jokerConflict = null"
    >
      <p style="margin: 0">
        <strong>{{ jokerConflict?.teamName }}</strong> üzerinde {{ jokerConflict?.jokerName }} oynanmış.
        Transferi uygularsan joker iptal edilir ve hakkın iade edilir.
      </p>
      <template #footer>
        <Button label="Vazgeç" text @click="jokerConflict = null" />
        <Button label="Devam et" severity="danger" @click="confirmJokerCancel" />
      </template>
    </Dialog>
  </section>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 1rem; }
.row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 0.9rem; align-items: end; }
@media (max-width: 700px) {
  .row { grid-template-columns: 1fr; }
}
</style>
