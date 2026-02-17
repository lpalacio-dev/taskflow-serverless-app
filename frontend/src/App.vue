<script setup>
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getCurrentUser } from 'aws-amplify/auth'
import { useTaskFlowStore } from './stores/taskflow'

const router   = useRouter()
const taskflow = useTaskFlowStore()

// Al montar la app, intentar restaurar la sesión si ya estaba activa
onMounted(async () => {
  try {
    await taskflow.loadSession()
    router.push('/app')
  } catch {
    router.push('/login')
  }
})
</script>

<template>
  <RouterView />
</template>
