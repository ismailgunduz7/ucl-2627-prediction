<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'primevue/usetoast';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { api, ApiRequestError } from '@/lib/api';
import PageHeader from '@/components/PageHeader.vue';
import TeamCrest from '@/components/TeamCrest.vue';

interface SquadClub {
  tierId: number;
  teamId: string;
  name: string;
  shortName: string;
  crestUrl: string | null;
  eliminated: boolean;
}
interface PlayerSquad {
  userId: string;
  displayName: string;
  username: string;
  competitionName: string | null;
  /** Set when the player joined late; their season starts at this week. */
  entryMatchweek: string | null;
  clubs: SquadClub[];
}

const { t } = useI18n();
const toast = useToast();
const squads = ref<PlayerSquad[]>([]);
const squadSize = ref(4);
const loading = ref(false);
const competition = ref<string | null>(null);

const pots = computed(() => Array.from({ length: squadSize.value }, (_, i) => i + 1));

/** One entry per competition, plus an "all" option, for the filter. */
const competitions = computed(() => {
  const names = [...new Set(squads.value.map((s) => s.competitionName).filter(Boolean))];
  return [
    { label: t('admin.squads.allCompetitions'), value: null },
    ...names.map((name) => ({ label: name as string, value: name as string })),
  ];
});

const rows = computed(() =>
  competition.value === null
    ? squads.value
    : squads.value.filter((s) => s.competitionName === competition.value),
);
const missing = computed(() => rows.value.filter((s) => s.clubs.length === 0).length);

function clubIn(squad: PlayerSquad, tierId: number): SquadClub | undefined {
  return squad.clubs.find((c) => c.tierId === tierId);
}

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ squads: PlayerSquad[]; squadSize: number }>('/api/admin/squads');
    squads.value = res.squads;
    squadSize.value = res.squadSize;
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: t('admin.squads.loadFailed'),
      detail: e instanceof ApiRequestError ? e.message : t('common.unexpectedError'),
      life: 4000,
    });
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>

<template>
  <div class="page-stack">
    <PageHeader :title="$t('nav.admin.squads')" :subtitle="$t('admin.squads.subtitle')">
      <template #actions>
        <Select
          v-model="competition"
          :options="competitions"
          option-label="label"
          option-value="value"
          style="min-width: 200px"
        />
      </template>
    </PageHeader>

    <section class="surface-card table-scroll">
      <DataTable :value="rows" :loading="loading" data-key="userId">
        <Column :header="$t('admin.squads.player')">
          <template #body="{ data }">
            <div class="who">
              <span class="who-name">{{ data.displayName }}</span>
              <span class="who-sub">{{ data.username }}</span>
              <span v-if="data.competitionName" class="who-sub">{{ data.competitionName }}</span>
            </div>
          </template>
        </Column>

        <Column v-for="pot in pots" :key="pot" :header="$t('common.pot', { number: pot })">
          <template #body="{ data }">
            <div v-if="clubIn(data, pot)" class="club" :class="{ out: clubIn(data, pot)!.eliminated }">
              <TeamCrest
                :name="clubIn(data, pot)!.name"
                :crest-url="clubIn(data, pot)!.crestUrl"
                size="sm"
              />
              <span class="club-name">{{ clubIn(data, pot)!.name }}</span>
            </div>
            <span v-else class="text-muted">-</span>
          </template>
        </Column>

        <Column :header="$t('admin.squads.startsAt')">
          <template #body="{ data }">
            <Tag v-if="data.clubs.length === 0" severity="danger" :value="$t('admin.squads.noSquad')" />
            <Tag
              v-else-if="data.entryMatchweek"
              severity="warn"
              :value="data.entryMatchweek"
            />
            <span v-else class="text-muted">{{ $t('admin.squads.fromTheStart') }}</span>
          </template>
        </Column>

        <template #empty>
          <span class="text-muted">{{ $t('admin.squads.empty') }}</span>
        </template>
      </DataTable>
    </section>

    <p v-if="!loading && missing > 0" class="text-muted missing-note">
      {{ $t('admin.squads.missingNote', { count: missing }, missing) }}
    </p>
  </div>
</template>

<style scoped>
.who {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}
.who-name {
  font-weight: 700;
}
.who-sub {
  color: var(--color-text-muted);
  font-size: var(--text-2xs);
}
.club {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}
/* An eliminated club still sits in the squad and still scores nothing. */
.club.out {
  opacity: 0.55;
}
.club-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.missing-note {
  margin: 0;
  font-size: var(--text-sm);
}
</style>
