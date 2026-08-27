<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Zap, Shield, Repeat, Armchair } from '@lucide/vue';
import { api } from '@/lib/api';
import PageHeader from '@/components/PageHeader.vue';
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
    desc: 'Kaptanın puanı iki yerine üç katına çıkar. Kilitten önce kaptan değiştirilirse joker yeni kaptana geçer.',
  },
  {
    code: 'bench_boost',
    name: 'Bench boost',
    icon: Armchair,
    desc: 'O hafta yedek dahil dört kulübün puanı birden yazılır. Kaptanlık yedekteki kulübe de verilebilir.',
  },
  {
    code: 'clean_sheet_shield',
    name: 'Gol yememe kalkanı',
    icon: Shield,
    desc: 'Sahadaki bir kulübe takılır. Kulüp tek gol yerse gol yememiş sayılır: gol yememe bonusu verilir, o golün cezası işlenmez. İki ve üzeri golde kalkan kırılır ve normal puanlama uygulanır. Kalkanlı kulüp yedeğe çekilirse joker iptal edilir ve hak iade edilir.',
  },
  {
    code: 'weekly_swap',
    name: 'Haftalık değişim',
    icon: Repeat,
    desc: 'Bir kulübün yerine aynı pottan, kadroda olmayan ve elenmemiş bir kulüp yalnızca o haftalık alınır. Gelen kulüp yedeğe çekilemez. Çıkan kulüp kaptansa kaptanlık gelen kulübe geçer. Hafta bitince kadro kendiliğinden eski haline döner.',
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
  <div class="page-stack rules-page">
    <PageHeader title="Nasıl oynanır" />

    <BallLoader v-if="loading" />

    <template v-else>
      <section class="surface-card card-pad">
        <div class="section-title">Kadro</div>
        <p>
          Her pottan bir kulüp seçilerek dört kulüplük kadro kurulur. Kadro ilk haftanın kilidine
          kadar serbestçe değiştirilebilir, sonrasında sezon boyunca sabit kalır. Tek kalıcı
          değişiklik hakkı lig aşaması bitince tanınır. Her hafta dört kulüpten biri yedeğe
          çekilir, sahada kalan üçten birine kaptanlık verilir. Yedeğe çekilen kulübün puanı o
          hafta yazılmaz, kaptanın puanı ise ikiyle çarpılır. Elenen kulüp kadrodan düşmez ama
          maçı kalmadığı için puan da getirmez.
        </p>
      </section>

      <section class="surface-card card-pad">
        <div class="section-title">Kilitler</div>
        <p>
          Bir hafta, o haftanın ilk maçından <b>beş dakika önce</b> kilitlenir. Diziliş, joker ve
          kupon o ana kadar serbestçe değiştirilebilir. İlk maçın başlamasıyla iki şey olur:
          sıradaki hafta düzenlemeye açılır ve tüm oyuncuların tercihleri (yedek, kaptan, varsa
          joker) birbirine görünür hale gelir. Kilitten önce hiçbir tercih başkasına gösterilmez.
        </p>
      </section>

      <section class="surface-card card-pad">
        <div class="section-title">Puan tablosu</div>
        <p>
          Aynı sonuç, zayıf pottaki bir kulüp için daha değerlidir. Güçlü bir kulübün kötü sonucu
          ise daha ağır cezalandırılır. Bir kulüp aynı hafta iki maç oynarsa ikisinin puanı da
          yazılır.
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
                  <span class="rule-cat">{{ categoryLabel[r.category] ?? r.category }}</span>
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
        <p>
          Haftada en fazla bir joker oynanabilir. Kilitten önce vazgeçilirse hak iade edilir.
          Haklar lig aşamasının başında verilir, lig bitince eleme turları için yeniden dağıtılır.
        </p>
        <div class="joker-grid stagger">
          <div v-for="j in jokers" :key="j.code" class="joker-card">
            <div class="joker-head">
              <component :is="j.icon" :size="18" />
              <b>{{ j.name }}</b>
            </div>
            <p class="joker-desc">{{ j.desc }}</p>
            <small v-if="grantLine(j.code)" class="joker-grant">{{ grantLine(j.code) }}</small>
          </div>
        </div>
      </section>

      <section class="surface-card card-pad">
        <div class="section-title">Lig bitince</div>
        <p>
          Lig aşaması tamamlandığında 25-36. sıradaki kulüpler elenir. İlk sekize giren kulüpler
          play-off oynamadan son 16'ya geçer ve boşta geçirecekleri haftalar için tek seferlik
          "Lig ilk 8 bonusu" alır.
        </p>
        <p>
          Joker hakları eleme turları için yeniden dağıtılır. Ayrıca bir transfer hakkı tanınır:
          kadrodan bir kulüp, aynı pottan başka bir kulüple <b>kalıcı olarak</b> değiştirilebilir.
          Pencere ilk eleme haftasının kilidine kadar açık kalır, bu süre içinde seçim istenildiği
          kadar güncellenebilir. Kullanılmayan hak yanar.
        </p>
        <p>
          Eleme turlarında her ayak kendi haftasıdır. Diziliş, joker ve kupon ayak ayak kilitlenir.
        </p>
      </section>

      <section class="surface-card card-pad">
        <div class="section-title">Ahtapot Paul</div>
        <p>
          Haftanın her maçı için ev sahibi galibiyeti (MS1), beraberlik (MS0) ya da deplasman
          galibiyeti (MS2) tahmini yapılabilir. Maçın oyuncunun kendi kulüplerine ait olması
          gerekmez. Tutan her tahmin {{ predictionPoints }} puan kazandırır ve haftalık toplama
          eklenir. Kupon dizilişle aynı anda kilitlenir. Seçili tahmine yeniden basıldığında
          tahmin geri alınır.
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
/* One voice, one colour: every paragraph on this page reads the same. */
.rules-page p {
  margin: 0 0 0.75rem;
  color: var(--color-text-secondary);
  line-height: 1.55;
}
.rules-page section > p:last-child { margin-bottom: 0; }
.rules-page p b { color: var(--color-text); }

.rules { width: 100%; border-collapse: collapse; min-width: 480px; }
.rules th, .rules td { padding: 0.6rem 0.75rem; text-align: center; border-bottom: 1px solid var(--color-border); }
.rules thead th { background: var(--color-bg-subtle); font-size: 0.82rem; font-weight: 700; color: var(--color-text-secondary); }
.rules tbody tr:last-child td { border-bottom: none; }
.rule-cat { font-size: 0.75rem; display: block; color: var(--color-text-secondary); }

.joker-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0.9rem; }
.joker-card { background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.9rem; display: flex; flex-direction: column; gap: 0.45rem; }
.joker-head { display: flex; align-items: center; gap: 0.5rem; color: var(--color-primary); }
.joker-head b { color: var(--color-text); }
.joker-desc { margin: 0; font-size: 0.86rem; }
.joker-grant {
  margin-top: auto; padding-top: 0.35rem;
  font-size: var(--text-2xs); font-weight: 700; color: var(--color-text-secondary);
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
