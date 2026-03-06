<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { auth } from '../auth';

const router = useRouter();

onMounted(async () => {
  try {
    await auth.handleRedirectCallback(window.location.href);
  } finally {
    await router.replace('/');
  }
});
</script>

<template>
  <p>Finalizing login...</p>
</template>
