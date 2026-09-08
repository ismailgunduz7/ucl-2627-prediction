<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useToast } from 'primevue/usetoast';
import Menu from 'primevue/menu';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import Message from 'primevue/message';
import { ChevronDown, LogOut, Settings, UserPlus } from '@lucide/vue';
import type { MenuItem } from 'primevue/menuitem';
import { ApiRequestError } from '@/lib/api';
import { useAuthStore, type AuthUser } from '@/stores/auth';

/**
 * The account on screen, and the way to reach the others.
 *
 * `chip` is the header button that opens a popup; `list` is the same options
 * laid out flat for the mobile drawer, where a popup inside a drawer would be a
 * menu inside a menu.
 */
const props = withDefaults(defineProps<{ variant?: 'chip' | 'list' }>(), { variant: 'chip' });
const emit = defineEmits<{ (e: 'navigate'): void }>();

const { t } = useI18n();
const router = useRouter();
const toast = useToast();
const auth = useAuthStore();

const menu = ref<InstanceType<typeof Menu> | null>(null);

/** Where an account belongs once it is on screen: admins have their own area. */
function homeFor(user: AuthUser): string {
  return user.isAdmin ? '/yonetim' : '/';
}

async function switchTo(userId: string) {
  try {
    const user = await auth.switchTo(userId);
    emit('navigate');
    await router.push(homeFor(user));
    toast.add({
      severity: 'success',
      summary: t('account.switched', { name: user.displayName }),
      life: 2500,
    });
  } catch (e) {
    toast.add({ severity: 'error', summary: t('account.switchFailed'), detail: msg(e), life: 4000 });
  }
}

// --- Add an account -------------------------------------------------------

const addDialog = ref(false);
const addForm = ref({ username: '', password: '' });
const addError = ref<string | null>(null);
const adding = ref(false);
const canAdd = computed(() => addForm.value.username.length > 0 && addForm.value.password.length > 0);

function openAdd() {
  addForm.value = { username: '', password: '' };
  addError.value = null;
  addDialog.value = true;
  emit('navigate');
}

async function submitAdd() {
  if (!canAdd.value) return;
  adding.value = true;
  addError.value = null;
  try {
    const user = await auth.login(addForm.value.username, addForm.value.password);
    addDialog.value = false;
    await router.push(homeFor(user));
    toast.add({
      severity: 'success',
      summary: t('account.added', { name: user.displayName }),
      life: 2500,
    });
  } catch (e) {
    addError.value = msg(e);
  } finally {
    adding.value = false;
  }
}

// --- Sign out -------------------------------------------------------------

const outDialog = ref(false);
const signingOut = ref(false);

function openSignOut() {
  outDialog.value = true;
  emit('navigate');
}

async function confirmSignOut() {
  signingOut.value = true;
  try {
    await auth.logout();
    outDialog.value = false;
    await router.replace('/login');
  } finally {
    signingOut.value = false;
  }
}

function openSettings() {
  emit('navigate');
  void router.push('/hesap');
}

function msg(e: unknown) {
  return e instanceof ApiRequestError ? e.message : t('common.unexpectedError');
}

const items = computed<MenuItem[]>(() => {
  const others = auth.otherAccounts.map((account) => ({
    key: account.id,
    account,
    command: () => switchTo(account.id),
  }));
  return [
    ...others,
    ...(others.length > 0 ? [{ separator: true }] : []),
    { key: 'add', label: t('account.add'), mark: UserPlus, command: openAdd },
    { key: 'settings', label: t('account.settings'), mark: Settings, command: openSettings },
    { key: 'out', label: t('common.signOut'), mark: LogOut, danger: true, command: openSignOut },
  ];
});
</script>

<template>
  <button
    v-if="props.variant === 'chip'"
    type="button"
    class="user-chip"
    aria-haspopup="true"
    :aria-label="$t('account.menuFor', { name: auth.user?.displayName })"
    @click="menu?.toggle($event)"
  >
    <span class="role-dot" />
    <span class="chip-name">{{ auth.user?.displayName }}</span>
    <ChevronDown :size="15" aria-hidden="true" />
  </button>
  <Menu v-if="props.variant === 'chip'" ref="menu" :model="items" popup class="account-menu">
    <template #item="{ item, props: itemProps }">
      <a v-bind="itemProps.action" class="account-menu-row" :class="{ danger: item.danger }">
        <template v-if="item.account">
          <span class="account-row-text">
            <span class="account-row-name">{{ item.account.displayName }}</span>
            <span class="account-row-sub">{{
              item.account.competitionName ?? $t('account.adminRole')
            }}</span>
          </span>
        </template>
        <template v-else>
          <component :is="item.mark" :size="16" aria-hidden="true" />
          <span>{{ item.label }}</span>
        </template>
      </a>
    </template>
  </Menu>

  <div v-else class="account-list">
    <button
      v-for="account in auth.otherAccounts"
      :key="account.id"
      type="button"
      class="mobile-nav-link account-row"
      @click="switchTo(account.id)"
    >
      <span class="account-row-text">
        <span class="account-row-name">{{ account.displayName }}</span>
        <span class="account-row-sub">{{ account.competitionName ?? $t('account.adminRole') }}</span>
      </span>
    </button>
    <button type="button" class="mobile-nav-link" @click="openAdd">
      <UserPlus :size="18" aria-hidden="true" />
      <span>{{ $t('account.add') }}</span>
    </button>
    <button type="button" class="mobile-nav-link" @click="openSettings">
      <Settings :size="18" aria-hidden="true" />
      <span>{{ $t('account.settings') }}</span>
    </button>
    <button type="button" class="mobile-nav-link danger" @click="openSignOut">
      <LogOut :size="18" aria-hidden="true" />
      <span>{{ $t('common.signOut') }}</span>
    </button>
  </div>

  <Dialog
    v-model:visible="addDialog"
    modal
    :header="$t('account.addTitle')"
    :style="{ width: '380px' }"
  >
    <p class="dialog-lead">{{ $t('account.addBody') }}</p>
    <form class="add-form" @submit.prevent="submitAdd">
      <div class="form-field">
        <label for="add-username">{{ $t('auth.username') }}</label>
        <InputText id="add-username" v-model="addForm.username" autocomplete="username" autofocus />
      </div>
      <div class="form-field">
        <label for="add-password">{{ $t('auth.password') }}</label>
        <Password
          input-id="add-password"
          v-model="addForm.password"
          :feedback="false"
          toggle-mask
          autocomplete="current-password"
        />
      </div>
      <Message v-if="addError" severity="error" :closable="false">{{ addError }}</Message>
      <button type="submit" hidden />
    </form>
    <template #footer>
      <Button :label="$t('common.cancel')" text @click="addDialog = false" />
      <Button
        :label="$t('account.addAction')"
        :loading="adding"
        :disabled="!canAdd"
        @click="submitAdd"
      >
        <template #icon><UserPlus :size="16" /></template>
      </Button>
    </template>
  </Dialog>

  <Dialog
    v-model:visible="outDialog"
    modal
    :header="$t('account.signOutTitle')"
    :style="{ width: '380px' }"
  >
    <p style="margin: 0">{{ $t('account.signOutBody') }}</p>
    <template #footer>
      <Button :label="$t('common.cancel')" text @click="outDialog = false" />
      <Button
        :label="$t('common.signOut')"
        severity="danger"
        :loading="signingOut"
        @click="confirmSignOut"
      >
        <template #icon><LogOut :size="16" /></template>
      </Button>
    </template>
  </Dialog>
</template>

<style scoped>
.chip-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-list {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.dialog-lead {
  margin: 0 0 0.9rem;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
.add-form {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}
</style>

<style>
/* The popup is teleported out of this component, so its rows are styled here. */
.account-menu .account-menu-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.account-menu .account-menu-row.danger,
.mobile-nav-link.danger {
  color: var(--color-danger);
}
.account-row-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
  text-align: left;
}
.account-row-name {
  font-weight: 600;
}
.account-row-sub {
  color: var(--color-text-muted);
  font-size: var(--text-2xs);
}
</style>
