<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useTaskFlowStore } from '../stores/taskflow'

const store  = useRouter()
const router = useRouter()

const taskflow = useTaskFlowStore()

const view         = ref('login')   // 'login' | 'register' | 'confirm'
const email        = ref('')
const password     = ref('')
const code         = ref('')
const errorMsg     = ref('')
const pendingEmail = ref('')

async function handleLogin() {
  errorMsg.value = ''
  try {
    await taskflow.login(email.value, password.value)
    router.push('/app')
  } catch (e) {
    errorMsg.value = e.message
  }
}

async function handleRegister() {
  errorMsg.value = ''
  try {
    await taskflow.register(email.value, password.value)
    pendingEmail.value = email.value
    view.value = 'confirm'
  } catch (e) {
    errorMsg.value = e.message
  }
}

async function handleConfirm() {
  errorMsg.value = ''
  try {
    await taskflow.confirm(pendingEmail.value, code.value)
    errorMsg.value = '✓ Cuenta verificada. Inicia sesión.'
    view.value = 'login'
  } catch (e) {
    errorMsg.value = e.message
  }
}
</script>

<template>
  <div class="auth-screen">
    <div class="auth-card">
      <div class="brand">Task<span>Flow</span></div>
      <div class="auth-sub">AWS Serverless · Real-time</div>

      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <!-- Login -->
      <div v-if="view === 'login'">
        <div class="field">
          <label>Email</label>
          <input type="email" v-model="email" placeholder="tu@email.com" @keyup.enter="handleLogin" />
        </div>
        <div class="field">
          <label>Password</label>
          <input type="password" v-model="password" placeholder="••••••••" @keyup.enter="handleLogin" />
        </div>
        <button class="btn btn-primary" @click="handleLogin">Iniciar sesión</button>
        <div class="auth-toggle">
          ¿No tienes cuenta?
          <a @click="view = 'register'">Regístrate</a>
        </div>
      </div>

      <!-- Register -->
      <div v-else-if="view === 'register'">
        <div class="field">
          <label>Email</label>
          <input type="email" v-model="email" placeholder="tu@email.com" />
        </div>
        <div class="field">
          <label>Password</label>
          <input type="password" v-model="password" placeholder="Mín. 8 caracteres" />
        </div>
        <button class="btn btn-primary" @click="handleRegister">Crear cuenta</button>
        <div class="auth-toggle">
          ¿Ya tienes cuenta?
          <a @click="view = 'login'">Inicia sesión</a>
        </div>
      </div>

      <!-- Confirm -->
      <div v-else-if="view === 'confirm'">
        <p class="confirm-hint">Revisa tu email y pega el código de verificación.</p>
        <div class="field">
          <label>Código de verificación</label>
          <input type="text" v-model="code" placeholder="123456" @keyup.enter="handleConfirm" />
        </div>
        <button class="btn btn-primary" @click="handleConfirm">Verificar</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-screen {
  display: flex; align-items: center; justify-content: center;
  min-height: 100vh; background: var(--bg);
}
.auth-card {
  background: var(--surface); border: 1px solid var(--border);
  border-top: 2px solid var(--accent);
  padding: 48px 40px; width: 100%; max-width: 420px; position: relative;
}
.auth-card::before {
  content: ''; position: absolute; top: -2px; left: 32px;
  width: 60px; height: 2px; background: var(--accent2);
}
.brand { font-size: 28px; font-weight: 800; letter-spacing: -1px; margin-bottom: 8px; }
.brand span { color: var(--accent); }
.auth-sub {
  font-family: var(--mono); font-size: 11px; color: var(--muted);
  letter-spacing: 2px; text-transform: uppercase; margin-bottom: 36px;
}
.error-msg {
  background: rgba(255,77,109,.1); border: 1px solid rgba(255,77,109,.3);
  color: var(--accent2); font-family: var(--mono); font-size: 12px;
  padding: 10px 14px; margin-bottom: 16px;
}
.confirm-hint {
  font-family: var(--mono); font-size: 12px; color: var(--muted); margin-bottom: 20px;
}
.auth-toggle {
  text-align: center; margin-top: 20px;
  font-family: var(--mono); font-size: 12px; color: var(--muted);
}
.auth-toggle a { color: var(--accent); cursor: pointer; }
.auth-toggle a:hover { text-decoration: underline; }
</style>