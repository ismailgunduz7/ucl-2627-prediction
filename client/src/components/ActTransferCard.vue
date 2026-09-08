<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
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

const { t } = useI18n();
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
/** Both ends of a committed transfer, by name. The destination stays in its
 *  own pot's candidate list precisely so it can be named here. */
const committedNames = computed(() => {
  const s = state.value;
  if (!s || s.status !== 'committed') return null;
  const option = s.options.find((o) => o.fromTeamId === s.fromTeamId);
  return {
    from: option?.fromName ?? t('transfer.aClub'),
    to: option?.candidates.find((c) => c.id === s.toTeamId)?.name ?? t('transfer.newClub'),
  };
});

async function load() {
  try {
    state.value = await api.get<State>('/api/act-transfer');
    fromId.value = state.value.fromTeamId;
    toId.value = state.value.toTeamId;
  } catch {
    // Nothing to offer if the window cannot be read. The page around it stands.
    state.value = null;
  }
}

// A club the transfer removes may carry an active joker. The server answers 409
// and waits for a confirmation before cancelling and refunding it.
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
    teamName: (first && names.get(first.teamId)) ?? t('squad.thisClub'),
    jokerName: jokerName(first?.code) || t('joker.generic'),
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
    toast.add({ severity: 'success', summary: t('transfer.applied'), life: 2500 });
    emit('changed');
  } catch (e) {
    if (e instanceof ApiRequestError && e.code === 'joker_squad_conflict') {
      jokerConflict.value = conflictText(e);
    } else {
      toast.add({
        severity: 'error',
        summary: t('transfer.failed'),
        detail: e instanceof ApiRequestError ? e.message : t('common.unexpectedError'),
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
        <div class="section-title flush">{{ $t('transfer.title') }}</div>
        <p class="transfer-note text-muted">
          {{ $t('transfer.subtitle') }}
        </p>
      </div>
      <Tag
        :severity="state!.status === 'committed' ? 'success' : state!.status === 'expired' ? 'danger' : 'info'"
        :value="
          state!.status === 'committed'
            ? $t('transfer.used')
            : state!.status === 'expired'
              ? $t('transfer.expired')
              : $t('transfer.available')
        "
      />
    </div>

    <Message v-if="state!.status === 'expired'" severity="secondary" :closable="false">
      {{ $t('transfer.expiredNotice') }}
    </Message>
    <Message v-else-if="state!.locked" severity="warn" :closable="false">
      {{ $t('transfer.lockedNotice') }}
    </Message>

    <template v-if="editable">
      <div class="row">
        <div class="form-field">
          <label>{{ $t('transfer.outLabel') }}</label>
          <Select
            v-model="fromId"
            :options="state!.options"
            option-label="fromName"
            option-value="fromTeamId"
            :placeholder="$t('transfer.outPlaceholder')"
            @change="toId = null"
          />
        </div>
        <div class="form-field">
          <label>{{ $t('transfer.inLabel') }}</label>
          <Select
            v-model="toId"
            :options="candidates"
            option-label="name"
            option-value="id"
            :disabled="!fromId"
            :placeholder="$t('transfer.inPlaceholder')"
          />
        </div>
        <Button
          :label="state!.status === 'committed' ? $t('transfer.change') : $t('transfer.apply')"
          :disabled="!fromId || !toId"
          :loading="saving"
          @click="submit()"
        />
      </div>
      <i18n-t
        v-if="committedNames"
        keypath="transfer.committed"
        tag="p"
        class="text-muted transfer-hint"
        scope="global"
      >
        <template #clubOut><strong>{{ committedNames.from }}</strong></template>
        <template #clubIn><strong>{{ committedNames.to }}</strong></template>
      </i18n-t>
    </template>

    <Dialog
      :visible="jokerConflict !== null"
      modal
      :header="$t('squad.conflictTitle')"
      class="dialog-md"
      @update:visible="jokerConflict = null"
    >
      <i18n-t class="flush" keypath="transfer.conflictBody" tag="p" scope="global">
        <template #club><strong>{{ jokerConflict?.teamName }}</strong></template>
        <template #joker>{{ jokerConflict?.jokerName }}</template>
      </i18n-t>
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="jokerConflict = null" />
        <Button :label="$t('common.continue')" severity="danger" @click="confirmJokerCancel" />
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

.transfer-note {
  margin: 0.25rem 0 0;
  font-size: 0.88rem;
}
.transfer-hint {
  margin: 0.75rem 0 0;
  font-size: 0.85rem;
}
</style>
