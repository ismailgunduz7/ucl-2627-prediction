<script setup lang="ts">
import Card from 'primevue/card';
</script>

<template>
  <div class="stack">
    <h1 style="margin: 0">Yönetim paneli</h1>
    <Card>
      <template #title>Faz 0 — Bootstrap</template>
      <template #content>
        <p>Temel altyapı hazır: kimlik doğrulama, kullanıcı ve yarışma yönetimi.</p>
        <ul>
          <li>Kullanıcılar sekmesinden yeni katılımcı/yönetici oluşturabilirsiniz.</li>
          <li>Yarışmalar yalnızca görünürlük gruplarıdır; kurallar tüm yarışmalarda ortaktır.</li>
        </ul>
      </template>
    </Card>
  </div>
</template>
