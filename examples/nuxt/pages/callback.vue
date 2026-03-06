<script setup lang="ts">
const auth = useAuthClient();
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
