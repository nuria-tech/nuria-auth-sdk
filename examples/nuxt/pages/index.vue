<script setup lang="ts">
const { auth, session, isLoading } = usePageAuth();
</script>

<template>
  <p v-if="isLoading">Loading...</p>
  <button v-else-if="!session" @click="auth.startLogin()">Login</button>
  <button v-else @click="auth.logout()">Logout</button>
</template>
