<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import Message from 'primevue/message';
import Tag from 'primevue/tag';
import { Check, CircleCheck } from '@lucide/vue';
import { useToast } from 'primevue/usetoast';
import { useTournamentStore } from '@/stores/tournament';
import { ApiRequestError } from '@/lib/api';
import { jokerName } from '@/lib/jokers';
import { countryName } from '@/lib/format';
import PageHeader from '@/components/PageHeader.vue';
import BallLoader from '@/components/BallLoader.vue';
import ActTransferCard from '@/components/ActTransferCard.vue';
import TeamCrest from '@/components/TeamCrest.vue';

const { t } = useI18n();
const store = useTournamentStore();
const toast = useToast();
const router = useRouter();

const loading = ref(true);
const saving = ref(false);
const picks = ref<Record<number, string | null>>({});
const now = ref(Date.now());
let timer: number | undefined;

const lockAt = computed(() => store.status?.selectionLock.lockAt ?? null);
const locked = computed(
  () => store.squadLocked || (lockAt.value ? now.value >= new Date(lockAt.value).getTime() : false),
);
const countdown = computed(() => {
  if (!lockAt.value) return null;
  const ms = new Date(lockAt.value).getTime() - now.value;
  if (ms <= 0) return t('squad.closed');
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return d > 0 ? t('common.countdownDays', { d, h }) : t('common.countdownHours', { h, m });
});
const pickedCount = computed(() => store.pots.filter((p) => picks.value[p.tierId]).length);
const allPicked = computed(() => store.pots.length > 0 && pickedCount.value === store.pots.length);

async function load() {
  loading.value = true;
  try {
    await Promise.all([store.loadTeams(), store.loadStatus(), store.loadSquad()]);
    for (const entry of store.squad) picks.value[entry.tierId] = entry.teamId;
  } catch (e) {
    toast.add({ severity: 'error', summary: t('squad.loadFailed'), detail: msg(e), life: 4000 });
  } finally {
    loading.value = false;
  }
}

function select(tierId: number, teamId: string) {
  if (locked.value) return;
  picks.value[tierId] = picks.value[tierId] === teamId ? null : teamId;
}

// A removed club may carry an active joker. The server answers 409 and waits
// for a confirmation before cancelling and refunding it.
const jokerConflict = ref<{ teamName: string; jokerName: string } | null>(null);

function conflictText(e: ApiRequestError): { teamName: string; jokerName: string } {
  const details = e.details as { conflicts?: { code: string; teamId: string }[] } | undefined;
  const first = details?.conflicts?.[0];
  const team = store.pots.flatMap((p) => p.teams).find((t) => t.id === first?.teamId);
  return {
    teamName: team?.name ?? t('squad.thisClub'),
    jokerName: jokerName(first?.code) || t('joker.generic'),
  };
}

async function save(cancelJokers = false) {
  if (!allPicked.value) return;
  saving.value = true;
  try {
    const teamIds = store.pots.map((p) => picks.value[p.tierId]!).filter(Boolean);
    await store.saveSquad(teamIds, cancelJokers);
    toast.add({ severity: 'success', summary: t('squad.saved'), life: 2500 });
    await router.push('/');
  } catch (e) {
    if (e instanceof ApiRequestError && e.code === 'joker_squad_conflict') {
      jokerConflict.value = conflictText(e);
    } else {
      toast.add({ severity: 'error', summary: t('common.saveFailed'), detail: msg(e), life: 5000 });
    }
  } finally {
    saving.value = false;
  }
}

async function confirmJokerCancel() {
  jokerConflict.value = null;
  await save(true);
}

function msg(e: unknown) {
  return e instanceof ApiRequestError ? e.message : t('common.unexpectedError');
}

onMounted(() => {
  load();
  timer = window.setInterval(() => (now.value = Date.now()), 1000);
});
onUnmounted(() => window.clearInterval(timer));
</script>

<template>
  <div class="page-stack">
    <PageHeader :title="$t('squad.title')" :subtitle="$t('squad.subtitle')">
      <template #actions>
        <Tag
          v-if="!loading && !locked && countdown"
          severity="info"
          :value="$t('squad.closesIn', { countdown })"
        />
      </template>
    </PageHeader>

    <Message v-if="!loading && locked" severity="warn" :closable="false">
      {{ $t('squad.lockedNotice') }}
    </Message>

    <BallLoader v-if="loading" />

    <template v-else>
      <ActTransferCard @changed="load" />

      <div class="tier-grid stagger">
        <section v-for="pot in store.pots" :key="pot.tierId" class="surface-card pot-col">
          <header class="pot-head">
            <span>{{ pot.tierName }}</span>
            <CircleCheck v-if="picks[pot.tierId]" :size="17" style="color: var(--color-success)" />
          </header>
          <button
            v-for="team in pot.teams"
            :key="team.id"
            type="button"
            class="team-row press"
            :class="{ selected: picks[pot.tierId] === team.id, disabled: locked }"
            :disabled="locked"
            @click="select(pot.tierId, team.id)"
          >
            <TeamCrest :name="team.name" :crest-url="team.crestUrl" size="sm" />
            <span class="team-meta">
              <span class="team-name">{{ team.name }}</span>
              <span v-if="team.country" class="text-muted" style="font-size: var(--text-2xs)">{{ countryName(team.country) }}</span>
            </span>
            <Tag v-if="team.eliminated" severity="danger" :value="$t('common.eliminated')" />
          </button>
        </section>
      </div>

      <div class="save-bar surface-card">
        <span class="text-muted">{{ $t('squad.progress', { picked: pickedCount, total: store.pots.length }) }}</span>
        <Button
          :label="locked ? $t('squad.lockedButton') : $t('squad.save')"
          :disabled="locked || !allPicked"
          :loading="saving"
          @click="save()"
        >
          <template #icon><Check :size="16" /></template>
        </Button>
      </div>
    </template>

    <Dialog
      :visible="jokerConflict !== null"
      modal
      :header="$t('squad.conflictTitle')"
      :style="{ width: '400px' }"
      @update:visible="jokerConflict = null"
    >
      <i18n-t keypath="squad.conflictBody" tag="p" style="margin: 0" scope="global">
        <template #club><strong>{{ jokerConflict?.teamName }}</strong></template>
        <template #joker>{{ jokerConflict?.jokerName }}</template>
      </i18n-t>
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="jokerConflict = null" />
        <Button :label="$t('common.continue')" severity="danger" @click="confirmJokerCancel" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.pot-col {
  padding: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.pot-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 700;
  padding: 0.25rem 0.35rem 0.6rem;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 0.35rem;
}
.team-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem;
  border: 1.5px solid transparent;
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: var(--color-text);
  transition: border-color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}
.team-row:hover:not(.disabled) {
  border-color: var(--color-border-strong);
}
.team-row.selected {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}
.team-row.disabled {
  cursor: not-allowed;
  opacity: 0.65;
}
.team-meta {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
  min-width: 0;
}
.team-name {
  font-size: var(--text-sm);
  font-weight: 600;
}
.save-bar {
  position: sticky;
  bottom: 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.85rem 1.25rem;
}

/* The bar follows the thumb up the page, clear of the home indicator. */
@media (max-width: 600px) {
  .save-bar {
    bottom: max(0.75rem, env(safe-area-inset-bottom));
    flex-direction: column;
    align-items: stretch;
    gap: 0.6rem;
    padding: 0.8rem;
  }
  .save-bar :deep(.p-button) { width: 100%; justify-content: center; }
}
</style>
