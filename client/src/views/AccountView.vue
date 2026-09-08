<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'primevue/usetoast';
import Password from 'primevue/password';
import Button from 'primevue/button';
import { Check } from '@lucide/vue';
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
        <span class="identity-name">{{ auth.user?.displayName }}</span>
        <span class="identity-username">{{ auth.user?.username }}</span>
        <span v-if="auth.user?.competitionName" class="identity-competition">
          {{ auth.user.competitionName }}
        </span>
      </div>
    </section>

    <section class="surface-card card-pad">
      <div class="section-title">{{ $t('account.languageTitle') }}</div>
      <div class="lang-row">
        <p class="text-muted lang-note">{{ $t('account.languageBody') }}</p>
        <LanguagePicker />
      </div>
    </section>

    <section class="surface-card card-pad">
      <div class="section-title">{{ $t('account.passwordTitle') }}</div>
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
.identity {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.identity-name {
  font-size: var(--text-lg);
  font-weight: 800;
  letter-spacing: -0.01em;
}
.identity-username {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  font-weight: 600;
}
.identity-competition {
  margin-top: 0.35rem;
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  font-weight: 600;
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
