<script setup lang="ts">
import { auth } from '../auth';
import { usePageAuth } from '../composables/usePageAuth';

const { session, isLoading } = usePageAuth();

const login = () => auth.startLogin();
const logout = () => auth.logout();
</script>

<template>
  <p v-if="isLoading">Loading...</p>
  <button v-else-if="!session" @click="login">Login</button>
  <button v-else @click="logout">Logout</button>
</template>
