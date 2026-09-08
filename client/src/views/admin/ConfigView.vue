<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'primevue/usetoast';
import Select from 'primevue/select';
import InputNumber from 'primevue/inputnumber';
import Button from 'primevue/button';
import { Check, FastForward } from '@lucide/vue';
import Tag from 'primevue/tag';
import { api, ApiRequestError } from '@/lib/api';
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

const { t } = useI18n();
const toast = useToast();
const config = ref<Config | null>(null);
const loading = ref(true);
const saving = ref(false);
const advancing = ref(false);
const dramaHours = ref(2);

const JOKER_CODES: JokerCode[] = ['weekly_swap', 'triple_boost', 'clean_sheet_shield', 'bench_boost'];
const ACTS: Act[] = ['league_phase', 'knockout'];
const providerOptions = computed(() => [
  { label: t('admin.sync.providerMock'), value: 'mock' },
  { label: 'football-data.org', value: 'football_data' },
]);

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ config: Config }>('/api/admin/config');
    config.value = res.config;
    dramaHours.value = Math.round((res.config.deadline_drama_window_seconds / 3600) * 10) / 10;
  } catch (e) {
    toast.add({ severity: 'error', summary: t('common.loadFailed'), detail: msg(e), life: 4000 });
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
    toast.add({ severity: 'success', summary: t('admin.config.saved'), life: 2500 });
    await load();
  } catch (e) {
    toast.add({ severity: 'error', summary: t('common.saveFailed'), detail: msg(e), life: 4500 });
  } finally {
    saving.value = false;
  }
}

/** Manual fallback: run the same progression a score pull normally triggers. */
async function advanceSeason() {
  advancing.value = true;
  try {
    await api.post('/api/admin/acts/advance');
    toast.add({ severity: 'success', summary: t('admin.config.seasonChecked'), life: 3000 });
    await load();
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.config.seasonCheckFailed'), detail: msg(e), life: 4000 });
  } finally {
    advancing.value = false;
  }
}

function msg(e: unknown) { return e instanceof ApiRequestError ? e.message : t('common.unexpectedError'); }
onMounted(load);
</script>

<template>
  <div class="page-stack">
    <PageHeader :title="$t('nav.admin.config')">
      <template #actions>
        <Button :label="$t('common.save')" :loading="saving" :disabled="loading" @click="save">
          <template #icon><Check :size="16" /></template>
        </Button>
      </template>
    </PageHeader>

    <BallLoader v-if="loading" />

    <template v-else-if="config">
      <section class="surface-card card-pad">
        <div class="section-title">{{ $t('admin.config.providerTitle') }}</div>
        <div class="row">
          <Select
            v-model="config.sync_provider"
            :options="providerOptions"
            option-label="label"
            option-value="value"
          class="select-filter"
          />
          <i18n-t keypath="admin.config.providerNote" tag="p" class="text-muted note" scope="global">
            <template #token><code>FOOTBALL_DATA_API_TOKEN</code></template>
          </i18n-t>
        </div>
      </section>

      <section class="surface-card card-pad">
        <div class="section-title">{{ $t('admin.users.jokersTitle') }}</div>
        <p class="text-muted note jokers-note">{{ $t('admin.config.jokersNote') }}</p>
        <div class="table-scroll">
          <table class="grants">
            <thead>
              <tr>
                <th class="text-start">{{ $t('admin.config.phase') }}</th>
                <th v-for="code in JOKER_CODES" :key="code">
                  <span class="joker-head"><JokerIcon :code="code" :size="14" /> {{ $t(`joker.${code}`) }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="act in ACTS" :key="act">
                <td class="text-start"><b>{{ $t(`admin.config.act.${act}`) }}</b></td>
                <td v-for="code in JOKER_CODES" :key="code">
                  <InputNumber
                    v-model="config.joker_inventory_defaults[act][code]"
                    :min="0"
                    :max="99"
                    :use-grouping="false"
                    show-buttons
                    button-layout="horizontal"
                    class="num-input"
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
        <div class="section-title">{{ $t('admin.config.dramaTitle') }}</div>
        <div class="row">
          <InputNumber
            v-model="dramaHours"
            :min="0"
            :max="48"
            :max-fraction-digits="1"
            :suffix="$t('admin.config.hoursSuffix')"
            show-buttons
          class="num-input-wide"
          />
          <p class="text-muted note">{{ $t('admin.config.dramaNote') }}</p>
        </div>
      </section>

      <section class="surface-card card-pad">
        <div class="section-title">{{ $t('admin.config.seasonTitle') }}</div>
        <div class="row">
          <Tag :value="$t(`admin.config.act.${config.current_act}`)" />
          <p class="text-muted note">{{ $t('admin.config.seasonNote') }}</p>
          <Button
            :label="$t('admin.config.checkSeason')"
            severity="secondary"
            outlined
            :loading="advancing"
            @click="advanceSeason"
          >
            <template #icon><FastForward :size="16" /></template>
          </Button>
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

.jokers-note { margin-bottom: 1rem; }
</style>
