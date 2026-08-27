<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useToast } from 'primevue/usetoast';
import Select from 'primevue/select';
import InputNumber from 'primevue/inputnumber';
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import { api, ApiRequestError } from '@/lib/api';
import { JOKER_NAMES } from '@/lib/jokers';
import PageHeader from '@/components/PageHeader.vue';
import BallLoader from '@/components/BallLoader.vue';
import JokerIcon from '@/components/JokerIcon.vue';

type JokerCode = 'weekly_swap' | 'triple_boost' | 'clean_sheet_shield' | 'bench_boost';
type Act = 'league_phase' | 'knockout';
interface Config {
  current_act: Act;
  joker_inventory_defaults: Record<Act, Record<JokerCode, number>>;
  deadline_drama_window_seconds: number;
  sync_provider: 'mock' | 'football_data';
}

const toast = useToast();
const config = ref<Config | null>(null);
const loading = ref(true);
const saving = ref(false);
const advancing = ref(false);
const dramaHours = ref(2);

const JOKER_CODES: JokerCode[] = ['weekly_swap', 'triple_boost', 'clean_sheet_shield', 'bench_boost'];
const ACTS: { key: Act; label: string }[] = [
  { key: 'league_phase', label: 'Lig aşaması' },
  { key: 'knockout', label: 'Eleme turları' },
];
const providerOptions = [
  { label: 'Simülasyon', value: 'mock' },
  { label: 'football-data.org', value: 'football_data' },
];

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ config: Config }>('/api/admin/config');
    config.value = res.config;
    dramaHours.value = Math.round((res.config.deadline_drama_window_seconds / 3600) * 10) / 10;
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Yüklenemedi', detail: msg(e), life: 4000 });
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!config.value) return;
  saving.value = true;
  try {
    // One request, one transaction. Three separate writes could leave the
    // provider switched over while the joker grants never landed, under a
    // message telling the admin nothing had been saved at all.
    await api.put('/api/admin/config', {
      updates: [
        { key: 'sync_provider', value: config.value.sync_provider },
        { key: 'joker_inventory_defaults', value: config.value.joker_inventory_defaults },
        { key: 'deadline_drama_window_seconds', value: Math.round(dramaHours.value * 3600) },
      ],
    });
    toast.add({ severity: 'success', summary: 'Ayarlar kaydedildi', life: 2500 });
    await load();
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Kaydedilemedi', detail: msg(e), life: 4500 });
  } finally {
    saving.value = false;
  }
}

/** Manual fallback: run the same progression a score pull normally triggers. */
async function advanceSeason() {
  advancing.value = true;
  try {
    await api.post('/api/admin/acts/advance');
    toast.add({ severity: 'success', summary: 'Sezon kontrol edildi', life: 3000 });
    await load();
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Sezon kontrol edilemedi', detail: msg(e), life: 4000 });
  } finally {
    advancing.value = false;
  }
}

function msg(e: unknown) { return e instanceof ApiRequestError ? e.message : 'Beklenmeyen hata'; }
onMounted(load);
</script>

<template>
  <div class="page-stack">
    <PageHeader title="Ayarlar">
      <template #actions>
        <Button label="Kaydet" icon="pi pi-check" :loading="saving" :disabled="loading" @click="save" />
      </template>
    </PageHeader>

    <BallLoader v-if="loading" />

    <template v-else-if="config">
      <section class="surface-card card-pad">
        <div class="section-title">Skor sağlayıcısı</div>
        <div class="row">
          <Select
            v-model="config.sync_provider"
            :options="providerOptions"
            option-label="label"
            option-value="value"
            style="min-width: 220px"
          />
          <p class="text-muted note">
            Skorlar buradan geliyor. Simülasyondayken arka plan işi beklemeye geçer, çünkü saati
            sen veriyorsun. football-data.org için sunucuda <code>FOOTBALL_DATA_API_TOKEN</code>
            tanımlı olmalı.
          </p>
        </div>
      </section>

      <section class="surface-card card-pad">
        <div class="section-title">Joker hakları</div>
        <p class="text-muted note" style="margin-bottom: 1rem">
          Lig değerleri yeni açılan hesaplara verilir. Eleme değerleri lig biterken herkese
          yeniden dağıtılır. Buradaki değişiklik kimsenin elindeki hakları değiştirmez, tek tek
          düzeltmek için Kullanıcılar sayfasına bak.
        </p>
        <div style="overflow-x: auto">
          <table class="grants">
            <thead>
              <tr>
                <th style="text-align: left">Dönem</th>
                <th v-for="code in JOKER_CODES" :key="code">
                  <span class="joker-head"><JokerIcon :code="code" :size="14" /> {{ JOKER_NAMES[code] }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="act in ACTS" :key="act.key">
                <td style="text-align: left"><b>{{ act.label }}</b></td>
                <td v-for="code in JOKER_CODES" :key="code">
                  <InputNumber
                    v-model="config.joker_inventory_defaults[act.key][code]"
                    :min="0"
                    :max="99"
                    :use-grouping="false"
                    show-buttons
                    button-layout="horizontal"
                    :input-style="{ width: '2.8rem', textAlign: 'center' }"
                    decrement-button-class="p-button-secondary"
                    increment-button-class="p-button-secondary"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="surface-card card-pad">
        <div class="section-title">Kilit uyarısı</div>
        <div class="row">
          <InputNumber
            v-model="dramaHours"
            :min="0"
            :max="48"
            :max-fraction-digits="1"
            suffix=" saat"
            show-buttons
            :input-style="{ width: '6rem' }"
          />
          <p class="text-muted note">Kilide bu kadar kalınca haftalık sayfadaki sayaç uyarı rengine geçer.</p>
        </div>
      </section>

      <section class="surface-card card-pad">
        <div class="section-title">Sezon</div>
        <div class="row">
          <Tag :value="config.current_act === 'league_phase' ? 'Lig aşaması' : 'Eleme turları'" />
          <p class="text-muted note">
            Sezon kendi kendine ilerliyor. Lig bitince eleme turları kuruluyor, biten turların
            galipleri bir sonrakine yazılıyor. Skorlar geciktiyse aynı kontrolü buradan elle
            çalıştırabilirsin.
          </p>
          <Button
            label="Sezonu kontrol et"
            icon="pi pi-forward"
            severity="secondary"
            outlined
            :loading="advancing"
            @click="advanceSeason"
          />
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.row { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
.note { margin: 0; font-size: 0.86rem; flex: 1; min-width: 240px; }
.note code { font-size: 0.8rem; background: var(--color-surface-2); padding: 0.1rem 0.3rem; border-radius: 4px; }
.grants { width: 100%; border-collapse: collapse; min-width: 620px; }
.grants th, .grants td { padding: 0.55rem 0.7rem; text-align: center; border-bottom: 1px solid var(--color-border); vertical-align: middle; }
.grants thead th { background: var(--color-bg-subtle); font-size: 0.8rem; font-weight: 700; color: var(--color-text-secondary); }
.grants tbody tr:last-child td { border-bottom: none; }
.joker-head { display: inline-flex; align-items: center; gap: 0.35rem; }
</style>
