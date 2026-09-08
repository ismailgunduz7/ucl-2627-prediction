<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'primevue/usetoast';
import Password from 'primevue/password';
import Button from 'primevue/button';
import { AtSign, Check, KeyRound, Languages, Trophy } from '@lucide/vue';
import { ApiRequestError } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import PageHeader from '@/components/PageHeader.vue';
import LanguagePicker from '@/components/LanguagePicker.vue';

const { t } = useI18n();
const toast = useToast();
const auth = useAuthStore();

const current = ref('');
const next = ref('');
const again = ref('');
const saving = ref(false);

/** The badge letter: the display name's first character, upper case. */
const initial = computed(() => (auth.user?.displayName ?? '?').trim().charAt(0).toLocaleUpperCase('tr'));

const mismatch = computed(() => again.value.length > 0 && next.value !== again.value);
const canSubmit = computed(
  () => current.value.length > 0 && next.value.length > 0 && next.value === again.value,
);

async function submit() {
  if (!canSubmit.value) return;
  saving.value = true;
  try {
    await auth.changePassword(current.value, next.value);
    current.value = '';
    next.value = '';
    again.value = '';
    toast.add({ severity: 'success', summary: t('account.changed'), life: 3000 });
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: t('account.changeFailed'),
      detail: e instanceof ApiRequestError ? e.message : t('common.unexpectedError'),
      life: 4000,
    });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="page-stack">
    <PageHeader :title="$t('account.title')" />

    <section class="surface-card card-pad">
      <div class="identity">
        <span class="identity-badge" aria-hidden="true">{{ initial }}</span>
        <div class="identity-lines">
          <span class="identity-name">{{ auth.user?.displayName }}</span>
          <span class="identity-line" :title="$t('account.usernameLabel')">
            <AtSign :size="14" aria-hidden="true" />
            <span class="sr-only">{{ $t('account.usernameLabel') }}</span>
            {{ auth.user?.username }}
          </span>
          <span
            v-if="auth.user?.competitionName"
            class="identity-line"
            :title="$t('account.competitionLabel')"
          >
            <Trophy :size="14" aria-hidden="true" />
            <span class="sr-only">{{ $t('account.competitionLabel') }}</span>
            {{ auth.user.competitionName }}
          </span>
        </div>
      </div>
    </section>

    <section class="surface-card card-pad">
      <div class="section-title">
        <Languages :size="18" aria-hidden="true" />{{ $t('account.languageTitle') }}
      </div>
      <div class="lang-row">
        <p class="text-muted lang-note">{{ $t('account.languageBody') }}</p>
        <LanguagePicker />
      </div>
    </section>

    <section class="surface-card card-pad">
      <div class="section-title">
        <KeyRound :size="18" aria-hidden="true" />{{ $t('account.passwordTitle') }}
      </div>
      <form class="pw-form" @submit.prevent="submit">
        <div class="form-field">
          <label for="pw-current">{{ $t('account.current') }}</label>
          <Password
            input-id="pw-current"
            v-model="current"
            :feedback="false"
            toggle-mask
            autocomplete="current-password"
          />
        </div>
        <div class="form-field">
          <label for="pw-next">{{ $t('account.next') }}</label>
          <Password
            input-id="pw-next"
            v-model="next"
            :feedback="false"
            toggle-mask
            autocomplete="new-password"
          />
        </div>
        <div class="form-field">
          <label for="pw-again">{{ $t('account.again') }}</label>
          <Password
            input-id="pw-again"
            v-model="again"
            :feedback="false"
            toggle-mask
            autocomplete="new-password"
            :invalid="mismatch"
          />
          <small v-if="mismatch" class="field-error">{{ $t('account.mismatch') }}</small>
        </div>
        <div class="pw-actions">
          <p class="text-muted pw-note">{{ $t('account.signsOthersOut') }}</p>
          <Button type="submit" :label="$t('common.save')" :disabled="!canSubmit" :loading="saving">
            <template #icon><Check :size="16" /></template>
          </Button>
        </div>
      </form>
    </section>
  </div>
</template>

<style scoped>
/* A card heading carries an icon here, so it is a row rather than a line. */
.section-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.section-title svg {
  color: var(--color-text-secondary);
}
.identity {
  display: flex;
  align-items: center;
  gap: 1rem;
}
/* The initial stands in for a photo nobody uploads in a game like this. */
.identity-badge {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--color-primary-soft);
  box-shadow: inset 0 0 0 1px var(--color-border-strong);
  font-size: var(--text-xl);
  font-weight: 800;
  color: #fff;
}
.identity-lines {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}
.identity-name {
  font-size: var(--text-lg);
  font-weight: 800;
  letter-spacing: -0.01em;
}
.identity-line {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  font-weight: 600;
}
.identity-line svg {
  flex-shrink: 0;
  color: var(--color-text-secondary);
}
.lang-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.lang-note {
  margin: 0;
  font-size: var(--text-sm);
}
/* One column, capped: a password field the width of a desktop is a target
   nobody aims at and a line nobody reads. */
.pw-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 380px;
}
.field-error {
  color: var(--color-danger);
  font-size: var(--text-xs);
  font-weight: 600;
}
.pw-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.pw-note {
  margin: 0;
  font-size: var(--text-xs);
  max-width: 20ch;
}
</style>
