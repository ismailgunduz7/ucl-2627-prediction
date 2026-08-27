<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Zap, Shield, Repeat, Armchair, Users, Lock, ArrowLeftRight } from '@lucide/vue';
import { api } from '@/lib/api';
import PageHeader from '@/components/PageHeader.vue';
import OctopusMark from '@/components/OctopusMark.vue';
import BallLoader from '@/components/BallLoader.vue';

interface RuleRow { code: string; category: string; label: string; points: Record<number, number> }
interface Pot { tierId: number; tierName: string; teams: { id: string; name: string }[] }
type JokerCounts = Record<string, number>;
interface JokerGrants { league_phase: JokerCounts; knockout: JokerCounts }

const rules = ref<RuleRow[]>([]);
const pots = ref<Pot[]>([]);
const predictionPoints = ref(3);
const grants = ref<JokerGrants | null>(null);
const loading = ref(true);

const categoryLabel: Record<string, string> = { match: 'Maç', league: 'Lig', knockout: 'Eleme' };

const jokers = [
  {
    code: 'triple_boost',
    name: 'Üçlü kaptan',
    icon: Zap,
    desc: 'Kaptanının puanı iki yerine üç katına çıkar. Kilitten önce kaptanı değiştirirsen joker yeni kaptana geçer.',
  },
  {
    code: 'bench_boost',
    name: 'Bench boost',
    icon: Armchair,
    desc: 'O hafta yedeğin dahil dört kulübün birden puan yazar; istersen kaptanlığı yedekteki kulübe bile verebilirsin.',
  },
  {
    code: 'clean_sheet_shield',
    name: 'Gol yememe kalkanı',
    icon: Shield,
    desc: 'Sahadaki bir kulübüne takarsın. Tek gol yerse gol yememiş sayılır: bonusunu alır, o golün cezasını yemez. İki ve üzeri golde kalkan kırılır, normal puanlama işler. Kalkanlı kulübü yedeğe çekersen joker iptal edilir, hakkın geri gelir.',
  },
  {
    code: 'weekly_swap',
    name: 'Haftalık değişim',
    icon: Repeat,
    desc: 'Bir kulübünün yerine aynı pottan, kadronda olmayan ve elenmemiş bir kulüp alırsın — sadece o haftalık. Gelen kulüp oynamaya gelir, yedeğe çekilemez; çıkan kulüp kaptansa şerit gelene geçer. Hafta bitince kadron kendiliğinden eskiye döner.',
  },
];

function grantLine(code: string): string | null {
  const g = grants.value;
  if (!g) return null;
  const league = g.league_phase[code] ?? 0;
  const ko = g.knockout[code] ?? 0;
  return `Lig aşamasında ${league}, eleme turlarında ${ko} hak`;
}

onMounted(async () => {
  try {
    const [r, t] = await Promise.all([
      api.get<{ rules: RuleRow[]; predictionPointsPerCorrect: number; jokerGrants: JokerGrants }>(
        '/api/scoring-rules',
      ),
      api.get<{ pots: Pot[] }>('/api/teams'),
    ]);
    rules.value = r.rules;
    pots.value = t.pots;
    predictionPoints.value = r.predictionPointsPerCorrect;
    grants.value = r.jokerGrants;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page-stack">
    <PageHeader title="Nasıl oynanır" />

    <BallLoader v-if="loading" />

    <template v-else>
      <section class="surface-card card-pad">
        <div class="section-title head-icon"><Users :size="18" /> Kadro</div>
        <p style="margin: 0">
          Her pottan bir kulüp seçip dört kulüplük kadronu kurarsın. Kadro ilk haftanın kilidine
          kadar serbest, sonrasında sezon boyunca seninle — tek kalıcı değişiklik hakkı lig aşaması
          biterken gelir. Her hafta dörtlünden birini yedeğe çeker, sahada kalan üçten birine
          kaptanlığı verirsin: yedeğin puanı o hafta yazılmaz, kaptanınki ikiyle çarpılır. Elenen
          kulüp kadrondan düşmez ama maçı olmadığı için puan da getirmez.
        </p>
      </section>

      <section class="surface-card card-pad">
        <div class="section-title head-icon"><Lock :size="18" /> Kilitler</div>
        <p style="margin: 0">
          Bir hafta, o haftanın ilk maçından <b>beş dakika önce</b> kilitlenir; diziliş, joker ve
          kupon o ana kadar istediğin kadar değişir. İlk maç başladığında iki şey olur: sıradaki
          hafta düzenlemeye açılır ve herkesin tercihi — yedek, kaptan, varsa joker — birbirine
          görünür olur. Kilitten önce kimse kimseninkini göremez.
        </p>
      </section>

      <section class="surface-card card-pad">
        <div class="section-title">Puan tablosu</div>
        <p style="margin: 0 0 0.75rem">
          Aynı sonuç, zayıf pottaki bir kulüp için daha değerlidir; güçlü bir kulübün kötü sonucu
          ise daha çok cezalandırılır. Bir kulüp o hafta iki maç oynarsa ikisinin puanı da yazılır.
        </p>
        <div style="overflow-x: auto">
          <table class="rules">
            <thead>
              <tr>
                <th style="text-align: left">Kural</th>
                <th v-for="p in pots" :key="p.tierId">{{ p.tierName }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rules" :key="r.code">
                <td style="text-align: left">
                  <strong>{{ r.label }}</strong>
                  <span class="text-muted" style="font-size: 0.75rem; display: block">{{ categoryLabel[r.category] ?? r.category }}</span>
                </td>
                <td v-for="p in pots" :key="p.tierId" :class="(r.points[p.tierId] ?? 0) < 0 ? 'text-negative' : ''">
                  {{ r.points[p.tierId] ?? 0 }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="surface-card card-pad">
        <div class="section-title">Jokerler</div>
        <p class="text-muted" style="margin: 0 0 1rem">
          Haftada en fazla bir joker oynanır. Kilitten önce vazgeçersen hakkın geri gelir; haklar
          lig aşamasının başında verilir, lig bitince eleme turları için baştan dağıtılır.
        </p>
        <div class="joker-grid stagger">
          <div v-for="j in jokers" :key="j.code" class="joker-card">
            <div class="joker-head">
              <component :is="j.icon" :size="18" />
              <b>{{ j.name }}</b>
            </div>
            <p class="text-muted" style="margin: 0; font-size: 0.86rem">{{ j.desc }}</p>
            <small v-if="grantLine(j.code)" class="joker-grant">{{ grantLine(j.code) }}</small>
          </div>
        </div>
      </section>

      <section class="surface-card card-pad">
        <div class="section-title head-icon"><ArrowLeftRight :size="18" /> Lig bitince</div>
        <p style="margin: 0">
          Lig aşaması tamamlanınca 25–36. sıradakiler elenir. İlk sekize girenler play-off
          oynamadan son 16'ya geçer ve boşta geçirecekleri o haftalar için tek seferlik bir bonus
          alır — tabloda "Lig ilk 8 bonusu". Joker hakların yenilenir, bir de transfer hakkın
          olur: istersen kadrondan bir kulübü aynı pottan başka bir kulüple <b>kalıcı olarak</b>
          değiştirirsin. Pencere ilk eleme haftasının kilidine kadar açık; o zamana kadar fikrini
          istediğin kadar değiştirebilirsin, kullanmazsan yanar. Eleme turlarında her ayak kendi
          haftasıdır: diziliş, joker ve kupon ayak ayak kilitlenir.
        </p>
      </section>

      <section class="surface-card card-pad">
        <div class="section-title paul-title"><OctopusMark :size="19" /> Ahtapot Paul</div>
        <p class="text-muted" style="margin: 0">
          Haftanın her maçı için MS1, MS0 ya da MS2 dersin — kendi kulüplerinin maçı olması
          gerekmez. Tutan her tahmin {{ predictionPoints }} puan yazar ve haftalık toplamına
          eklenir. Kupon, dizilişle aynı anda kilitlenir; seçimine tekrar basarsan geri alırsın.
        </p>
      </section>

      <section class="surface-card card-pad">
        <div class="section-title">Potlar ve kulüpler</div>
        <div class="pot-grid">
          <div v-for="p in pots" :key="p.tierId" class="pot-box">
            <div class="pot-box-head">{{ p.tierName }}</div>
            <div class="chip-wrap">
              <RouterLink v-for="t in p.teams" :key="t.id" :to="`/takim/${t.id}`" class="team-chip">{{ t.name }}</RouterLink>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.head-icon { display: flex; align-items: center; gap: 0.5rem; }
.head-icon svg { color: var(--color-primary); }
.rules { width: 100%; border-collapse: collapse; min-width: 480px; }
.rules th, .rules td { padding: 0.6rem 0.75rem; text-align: center; border-bottom: 1px solid var(--color-border); }
.rules thead th { background: var(--color-bg-subtle); font-size: 0.82rem; font-weight: 700; color: var(--color-text-secondary); }
.rules tbody tr:last-child td { border-bottom: none; }
.paul-title { display: flex; align-items: center; gap: 0.5rem; }
.joker-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0.9rem; }
.joker-card { background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.9rem; display: flex; flex-direction: column; gap: 0.45rem; }
.joker-head { display: flex; align-items: center; gap: 0.5rem; color: var(--color-primary); }
.joker-head b { color: var(--color-text); }
.joker-grant {
  margin-top: auto; padding-top: 0.35rem;
  font-size: var(--text-2xs); font-weight: 700; color: var(--color-primary);
}
.pot-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 1rem; }
.pot-box { background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.85rem; }
.pot-box-head { font-weight: 700; margin-bottom: 0.6rem; }
.chip-wrap { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.team-chip {
  display: inline-block; padding: 0.3rem 0.65rem; border-radius: 999px;
  background: var(--color-surface); border: 1px solid var(--color-border);
  font-size: 0.8rem; color: var(--color-text); text-decoration: none;
}
.team-chip:hover { border-color: var(--color-primary); color: var(--color-primary); text-decoration: none; }
</style>
