<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import { api, ApiRequestError } from '@/lib/api';
import BallLoader from '@/components/BallLoader.vue';
import FixtureLine from '@/components/FixtureLine.vue';

interface TeamDetail {
  team: { id: string; name: string; shortName: string; tierName: string; country: string | null; eliminated: boolean };
  totalPoints: number;
  matches: {
    matchId: string; matchweekLabel: string; status: string; isHome: boolean;
    opponentName: string; teamScore: number | null; opponentScore: number | null; points: number | null;
    entries: { ruleCode: string; ruleLabel: string; points: number }[];
  }[];
}

const route = useRoute();
const router = useRouter();
const detail = ref<TeamDetail | null>(null);
const openMatch = ref<string | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

const statusLabel: Record<string, string> = {
  scheduled: 'Planlandı', live: 'Canlı', finished: 'Bitti', postponed: 'Ertelendi', cancelled: 'İptal',
};

function initials(name: string) { return name.split(' ').map((w) => w[0]).slice(0, 3).join('').toUpperCase(); }

async function load(id: string) {
  loading.value = true;
  error.value = null;
  try {
    detail.value = await api.get<TeamDetail>(`/api/teams/${id}`);
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : 'Yüklenemedi';
  } finally {
    loading.value = false;
  }
}

onMounted(() => load(route.params.id as string));
watch(() => route.params.id, (id) => id && load(id as string));
</script>

<template>
  <div class="page-stack">
    <Button label="Geri" icon="pi pi-arrow-left" text style="align-self: flex-start" @click="router.back()" />

    <BallLoader v-if="loading" />
    <p v-else-if="error" class="empty-state">{{ error }}</p>

    <template v-else-if="detail">
      <section class="surface-card card-pad team-head">
        <span class="crest">{{ initials(detail.team.name) }}</span>
        <div style="flex: 1">
          <h1 style="margin: 0; font-size: 1.5rem">{{ detail.team.name }}</h1>
          <div class="tag-row" style="margin-top: 0.4rem">
            <Tag :value="detail.team.tierName" />
            <span v-if="detail.team.country" class="text-muted">{{ detail.team.country }}</span>
            <Tag v-if="detail.team.eliminated" severity="danger" value="Elendi" />
          </div>
        </div>
        <div class="total">
          <div class="total-num">{{ detail.totalPoints }}</div>
          <small class="text-muted">toplam puan</small>
        </div>
      </section>

      <section class="surface-card" style="overflow: hidden">
        <table class="matches">
          <thead>
            <tr><th style="text-align: left">Hafta</th><th style="text-align: left">Maç</th><th>Durum</th><th>Puan</th></tr>
          </thead>
          <tbody>
            <template v-for="m in detail.matches" :key="m.matchId">
            <tr
              :class="{ clickable: m.entries.length, open: openMatch === m.matchId }"
              @click="m.entries.length && (openMatch = openMatch === m.matchId ? null : m.matchId)"
            >
              <td style="text-align: left">{{ m.matchweekLabel }}</td>
              <td style="text-align: left">
                <FixtureLine
                  :team-name="detail.team.name"
                  :opponent-name="m.opponentName"
                  :home="m.isHome"
                  :team-score="m.teamScore"
                  :opponent-score="m.opponentScore"
                />
              </td>
              <td class="text-muted" style="font-size: 0.85rem">{{ statusLabel[m.status] ?? m.status }}</td>
              <td>
                <strong v-if="m.points !== null" :class="m.points >= 0 ? 'text-positive' : 'text-negative'">
                  {{ m.points > 0 ? '+' : '' }}{{ m.points }}
                </strong>
                <span v-else class="text-muted">—</span>
              </td>
            </tr>
            <tr v-if="openMatch === m.matchId" class="entry-row">
              <td colspan="4">
                <ul class="entries">
                  <li v-for="(e, i) in m.entries" :key="i">
                    <span>{{ e.ruleLabel }}</span>
                    <span :class="e.points >= 0 ? 'text-positive' : 'text-negative'">
                      {{ e.points > 0 ? '+' : '' }}{{ e.points }}
                    </span>
                  </li>
                </ul>
              </td>
            </tr>
            </template>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<style scoped>
.team-head { display: flex; align-items: center; gap: 1.1rem; }
.crest {
  width: 60px; height: 60px; border-radius: 50%;
  background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
  color: #fff; display: grid; place-items: center; font-weight: 800;
}
.total { text-align: center; }
.total-num { font-size: 2rem; font-weight: 800; color: var(--color-primary); line-height: 1; }
.matches { width: 100%; border-collapse: collapse; }
.matches th, .matches td { padding: 0.6rem 0.85rem; text-align: center; border-bottom: 1px solid var(--color-border); font-size: 0.9rem; }
.matches thead th { background: var(--color-bg-subtle); font-size: 0.8rem; font-weight: 700; color: var(--color-text-secondary); }
.matches tbody tr:last-child td { border-bottom: none; }
.matches tr.clickable { cursor: pointer; }
.matches tr.clickable:hover td { background: var(--color-surface-2); }
.matches tr.open td { background: var(--color-surface-2); }
.entry-row td { background: var(--color-bg-subtle); padding: 0.6rem 1.1rem; }
.entries { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; max-width: 360px; }
.entries li { display: flex; justify-content: space-between; gap: 1rem; font-size: 0.84rem; }
.entries li > span:last-child { font-weight: 700; }
</style>
