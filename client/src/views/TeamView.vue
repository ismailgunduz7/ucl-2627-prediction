<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import { api, ApiRequestError } from '@/lib/api';

interface TeamDetail {
  team: {
    id: string;
    name: string;
    shortName: string;
    tierId: number;
    tierName: string;
    country: string | null;
    eliminated: boolean;
  };
  totalPoints: number;
  matches: {
    matchId: string;
    matchweekLabel: string;
    kickoffAt: string;
    status: string;
    isHome: boolean;
    opponentName: string;
    teamScore: number | null;
    opponentScore: number | null;
    points: number | null;
  }[];
}

const route = useRoute();
const router = useRouter();
const detail = ref<TeamDetail | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

const statusLabel: Record<string, string> = {
  scheduled: 'Planlandı',
  live: 'Canlı',
  finished: 'Bitti',
  postponed: 'Ertelendi',
  cancelled: 'İptal',
};

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).slice(0, 3).join('').toUpperCase();
}

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
  <div class="page stack">
    <Button label="Geri" icon="pi pi-arrow-left" text style="align-self: flex-start" @click="router.back()" />

    <div v-if="loading">Yükleniyor…</div>
    <div v-else-if="error">{{ error }}</div>

    <template v-else-if="detail">
      <div class="team-head">
        <span class="crest">{{ initials(detail.team.name) }}</span>
        <div>
          <h1 style="margin: 0">{{ detail.team.name }}</h1>
          <div style="color: #667; display: flex; gap: 0.5rem; align-items: center; margin-top: 0.25rem">
            <Tag :value="detail.team.tierName" />
            <span v-if="detail.team.country">{{ detail.team.country }}</span>
            <Tag v-if="detail.team.eliminated" severity="danger" value="Elendi" />
          </div>
        </div>
        <div class="total">
          <div class="total-num">{{ detail.totalPoints }}</div>
          <small>toplam puan</small>
        </div>
      </div>

      <table class="match-table">
        <thead>
          <tr>
            <th style="text-align: left">Hafta</th>
            <th style="text-align: left">Maç</th>
            <th>Skor</th>
            <th>Durum</th>
            <th>Puan</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in detail.matches" :key="m.matchId">
            <td style="text-align: left">{{ m.matchweekLabel }}</td>
            <td style="text-align: left">
              <span v-if="m.isHome">{{ detail.team.shortName }} <small style="color:#889">(ev)</small> vs {{ m.opponentName }}</span>
              <span v-else>{{ m.opponentName }} vs {{ detail.team.shortName }} <small style="color:#889">(dep)</small></span>
            </td>
            <td>
              <template v-if="m.teamScore !== null && m.opponentScore !== null">
                {{ m.isHome ? m.teamScore : m.opponentScore }}–{{ m.isHome ? m.opponentScore : m.teamScore }}
              </template>
              <span v-else style="color: #aab">—</span>
            </td>
            <td><small>{{ statusLabel[m.status] ?? m.status }}</small></td>
            <td>
              <strong v-if="m.points !== null" :style="{ color: m.points >= 0 ? '#166534' : '#b91c1c' }">
                {{ m.points > 0 ? '+' : '' }}{{ m.points }}
              </strong>
              <span v-else style="color: #aab">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<style scoped>
.team-head {
  display: flex;
  align-items: center;
  gap: 1rem;
  background: #fff;
  border-radius: 10px;
  padding: 1rem 1.25rem;
}
.crest {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--brand);
  color: #fff;
  display: grid;
  place-items: center;
  font-weight: 700;
}
.total {
  margin-left: auto;
  text-align: center;
}
.total-num {
  font-size: 1.8rem;
  font-weight: 800;
  color: var(--brand);
}
.match-table {
  border-collapse: collapse;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  width: 100%;
}
.match-table th,
.match-table td {
  padding: 0.5rem 0.7rem;
  text-align: center;
  border-bottom: 1px solid #eef;
}
.match-table thead th {
  background: #f4f6fb;
  font-size: 0.82rem;
}
</style>
