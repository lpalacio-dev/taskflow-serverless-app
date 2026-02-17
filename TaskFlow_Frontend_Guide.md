# 🚀 FASE 4 — Frontend Vue.js con Amplify Gen 2

> **Reemplaza** la Fase 4 anterior (la que usaba Amplify CLI).
> Amplify Gen 2 usa un enfoque **code-first**: defines tu infraestructura en TypeScript,
> sin wizard de CLI. El hosting se conecta directamente a tu repositorio Git.

---

## 📋 Índice
1. [¿Qué cambia con Amplify Gen 2?](#qué-cambia-con-amplify-gen-2)
2. [Pre-requisitos](#pre-requisitos)
3. [Paso 4.1 — Crear el proyecto Vue](#paso-41--crear-el-proyecto-vue)
4. [Paso 4.2 — Instalación manual de Amplify](#paso-42--instalación-manual-de-amplify)
5. [Paso 4.3 — Configurar Amplify para usar tu Cognito existente](#paso-43--configurar-amplify-para-usar-tu-cognito-existente)
6. [Paso 4.4 — Crear los componentes Vue](#paso-44--crear-los-componentes-vue)
7. [Paso 4.5 — Conectar al AWS Toolkit de VS Code](#paso-45--conectar-al-aws-toolkit-de-vs-code)
8. [Paso 4.6 — Deploy con Amplify Hosting](#paso-46--deploy-con-amplify-hosting)
9. [Paso 4.7 — Verificar que todo funciona](#paso-47--verificar-que-todo-funciona)
10. [Troubleshooting](#troubleshooting)

---

## ¿Qué cambia con Amplify Gen 2?

| Amplify Gen 1 (CLI) | Amplify Gen 2 (actual) |
|---|---|
| `amplify init` + wizard interactivo | Instalación manual con npm |
| `amplify add auth` genera recursos nuevos | Puedes conectar recursos AWS **existentes** |
| `amplify publish` sube archivos | Hosting conectado a **GitHub**, deploy automático en cada push |
| Configuración en archivos JSON en `/amplify` | Configuración en **TypeScript** en `/amplify` |
| CLI pesado (~200MB) | Solo paquetes npm, sin CLI global |

**Lo más importante para nosotros:** Gen 2 permite traer tu propio Cognito User Pool (el que ya creó SAM), en lugar de crear uno nuevo. Esto es exactamente lo que necesitamos.

---

## Pre-requisitos

- ✅ El backend SAM ya deployado (tienes los Outputs: `UserPoolId`, `UserPoolClientId`, `HttpApiEndpoint`, `WebSocketEndpoint`)
- ✅ Node.js 20+
- ✅ Cuenta GitHub con repositorio creado para el proyecto
- ✅ AWS Toolkit instalado en VS Code (ya lo tienes)
- ✅ Perfil AWS configurado en el Toolkit

**Guardar los valores del deploy SAM** — los necesitarás en el Paso 4.3:
```
HTTP_API_ENDPOINT   = https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod
WEBSOCKET_ENDPOINT  = wss://yyyyyyyyyy.execute-api.us-east-1.amazonaws.com/prod
USER_POOL_ID        = us-east-1_Xxxxxxxxx
USER_POOL_CLIENT_ID = 1abc2defghijklmnopqrstuvwx
REGION              = us-east-1
```

---

## Paso 4.1 — Crear el proyecto Vue

Desde la raíz de tu proyecto `taskflow/`, reemplaza la carpeta `frontend/` con un proyecto Vue real.

```bash
# Desde taskflow/
# Si tienes la carpeta frontend con el index.html viejo, elimínala
rm -rf frontend

# Crear proyecto Vue con Vite
npm create vue@latest frontend
```

El asistente de Vue te preguntará varias cosas. Responde exactamente así:

```
✔ Project name: … frontend
✔ Add TypeScript? … No
✔ Add JSX Support? … No
✔ Add Vue Router for Single Page Application development? … Yes
✔ Add Pinia for state management? … Yes
✔ Add Vitest for Unit Testing? … No
✔ Add an End-to-End Testing Solution? … No
✔ Add ESLint for code quality? … Yes
✔ Add Prettier for code formatting? … No
```

**¿Por qué estas opciones?**
- **Vue Router**: necesitamos rutas `/login` y `/app` separadas.
- **Pinia**: manejo de estado global (el equivalente moderno de Vuex). Guardará el token, las tareas y el estado del WebSocket.
- Sin TypeScript por velocidad, pero la estructura queda igual si después quieres agregarlo.

```bash
cd frontend
npm install
```

**Verificar que funciona:**
```bash
npm run dev
# Abre http://localhost:5173 — deberías ver la página de bienvenida de Vue
```

**Estructura que tendrás:**
```
frontend/
├── amplify/                  ← crearemos esto en el Paso 4.2
├── public/
├── src/
│   ├── assets/
│   ├── components/           ← aquí van nuestros componentes
│   ├── router/
│   │   └── index.js
│   ├── stores/               ← Pinia stores
│   │   └── counter.js        (este lo borraremos)
│   ├── views/
│   │   ├── HomeView.vue      (este lo reemplazaremos)
│   │   └── AboutView.vue     (este lo borraremos)
│   ├── App.vue
│   └── main.js
├── index.html
├── vite.config.js
└── package.json
```

---

## Paso 4.2 — Instalación manual de Amplify

Amplify Gen 2 se instala como paquetes npm. No hay CLI global.

```bash
# Dentro de frontend/
npm install aws-amplify
npm install --save-dev @aws-amplify/backend @aws-amplify/backend-cli
```

**¿Para qué es cada paquete?**
- `aws-amplify`: el SDK del frontend — maneja auth, llamadas API, etc.
- `@aws-amplify/backend`: define tu backend en TypeScript (aunque nosotros usaremos el backend SAM existente)
- `@aws-amplify/backend-cli`: herramientas para deploy del hosting

**Crear la estructura de Amplify Gen 2:**

```bash
# Desde frontend/
mkdir -p amplify
```

Crea el archivo `amplify/backend.ts`:

```typescript
import { defineBackend } from '@aws-amplify/backend';

/**
 * TaskFlow — backend existente vía SAM.
 *
 * No definimos auth ni API aquí porque ya existen en AWS
 * (creados por nuestro template.yaml de SAM).
 * Solo usamos Amplify para el hosting del frontend.
 *
 * La configuración de los recursos existentes va en
 * src/amplify-config.js (Paso 4.3).
 */
export const backend = defineBackend({});
```

**¿Por qué el archivo está casi vacío?** En Amplify Gen 2 puro se definiría aquí el auth, las APIs, etc. Como nosotros ya tenemos todo en SAM, solo necesitamos Amplify para el hosting. La conexión a los recursos existentes se hace mediante configuración manual en el frontend.

---

## Paso 4.3 — Configurar Amplify para usar tu Cognito existente

Esta es la parte clave de "traer tus propios recursos". En lugar de que Amplify cree un nuevo Cognito, le decimos cuál usar.

**Crea `src/amplify-config.js`** con los valores de los Outputs de tu deploy SAM:

```javascript
/**
 * Configuración de Amplify apuntando a los recursos
 * creados por nuestro template.yaml de SAM.
 *
 * Reemplaza los valores con los Outputs de: sam deploy
 */
export const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId:       'us-east-1_XXXXXXXXX',        // ← Output: UserPoolId
      userPoolClientId: '1abc2defghijklmnopqrstuvwx', // ← Output: UserPoolClientId
      loginWith: {
        email: true,
      },
    },
  },
};

// URLs de tus APIs (del deploy SAM)
export const apiConfig = {
  httpApi:   'https://XXXXXXXXXX.execute-api.us-east-1.amazonaws.com/prod',
  wsApi:     'wss://YYYYYYYYYY.execute-api.us-east-1.amazonaws.com/prod',
};
```

**Actualiza `src/main.js`** para inicializar Amplify al arrancar la app:

```javascript
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { Amplify } from 'aws-amplify'
import { amplifyConfig } from './amplify-config'
import App from './App.vue'
import router from './router'
import './assets/main.css'

// Inicializar Amplify con la configuración de recursos existentes
Amplify.configure(amplifyConfig)

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
```

---

## Paso 4.4 — Crear los componentes Vue

Vamos a crear 4 archivos que reemplazan toda la lógica del `index.html` original, pero ahora organizada en componentes Vue reales.

### Limpiar archivos que no necesitamos

```bash
# Borrar los archivos de ejemplo de Vue
rm src/views/AboutView.vue
rm src/stores/counter.js
rm src/components/HelloWorld.vue
rm src/components/TheWelcome.vue
rm src/components/WelcomeItem.vue
rm -rf src/components/icons
```

---

### Archivo 1 — Store de Pinia: `src/stores/taskflow.js`

El store centraliza todo el estado: el usuario, las tareas, el WebSocket. Los componentes solo llaman acciones del store.

```javascript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  signIn, signUp, signOut, confirmSignUp,
  getCurrentUser, fetchAuthSession
} from 'aws-amplify/auth'
import { apiConfig } from '../amplify-config'

export const useTaskFlowStore = defineStore('taskflow', () => {

  // ── Estado ──────────────────────────────────────────────────────────────
  const user        = ref(null)      // { userId, email, username }
  const token       = ref(null)      // JWT IdToken de Cognito
  const tasks       = ref([])
  const currentProjectId = ref('default')
  const wsConnected = ref(false)
  const projects    = ref([
    { id: 'default',  name: 'General',  color: '#00e5c0' },
    { id: 'frontend', name: 'Frontend', color: '#ffd166' },
    { id: 'backend',  name: 'Backend',  color: '#ff4d6d' },
  ])

  let ws = null

  // ── Computed ─────────────────────────────────────────────────────────────
  const isAuthenticated = computed(() => !!user.value)

  const tasksByStatus = computed(() => ({
    PENDING:     tasks.value.filter(t => t.status === 'PENDING'),
    IN_PROGRESS: tasks.value.filter(t => t.status === 'IN_PROGRESS'),
    DONE:        tasks.value.filter(t => t.status === 'DONE'),
  }))

  const currentProject = computed(() =>
    projects.value.find(p => p.id === currentProjectId.value)
  )

  // ── Auth Actions ──────────────────────────────────────────────────────────
  async function login(email, password) {
    await signIn({ username: email, password })
    await loadSession()
  }

  async function register(email, password) {
    await signUp({
      username: email,
      password,
      options: { userAttributes: { email } }
    })
  }

  async function confirm(email, code) {
    await confirmSignUp({ username: email, confirmationCode: code })
  }

  async function logout() {
    disconnectWs()
    await signOut()
    user.value  = null
    token.value = null
    tasks.value = []
  }

  async function loadSession() {
    // Obtener sesión activa (funciona también al recargar la página)
    const cognitoUser = await getCurrentUser()
    const session     = await fetchAuthSession()
    token.value = session.tokens?.idToken?.toString()
    user.value  = {
      userId:   cognitoUser.userId,
      email:    cognitoUser.signInDetails?.loginId ?? '',
      username: cognitoUser.username,
    }
  }

  // ── API Actions ───────────────────────────────────────────────────────────
  async function apiRequest(method, path, body) {
    const res = await fetch(`${apiConfig.httpApi}${path}`, {
      method,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token.value}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
    return res.json()
  }

  async function loadTasks() {
    const result = await apiRequest('GET', `/tasks?projectId=${currentProjectId.value}`)
    tasks.value = result ?? []
  }

  async function saveTask(taskData) {
    const taskId = taskData.taskId || crypto.randomUUID()
    const item   = await apiRequest('PUT', '/tasks', {
      ...taskData,
      taskId,
      projectId: currentProjectId.value,
      createdBy: user.value?.userId,
    })
    // Si no hay WS activo, actualizar estado local
    if (!wsConnected.value) upsertTaskLocal(typeof item === 'object' ? item : { ...taskData, taskId })
  }

  async function deleteTask(taskId) {
    await apiRequest('DELETE', `/tasks/${taskId}`)
    if (!wsConnected.value) tasks.value = tasks.value.filter(t => t.taskId !== taskId)
  }

  async function moveTask(taskId, newStatus) {
    const task = tasks.value.find(t => t.taskId === taskId)
    if (!task) return
    await saveTask({ ...task, status: newStatus })
    if (!wsConnected.value) task.status = newStatus
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────
  function connectWs() {
    // Los browsers no permiten headers custom en WebSocket nativo,
    // por eso pasamos el token como query param.
    // El Authorizer de Lambda debe leerlo de queryStringParameters.token
    const wsUrl = `${apiConfig.wsApi}?token=${token.value}`
    ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      wsConnected.value = true
      console.log('WebSocket connected')
    }

    ws.onclose = () => {
      wsConnected.value = false
      // Reconexión automática si el usuario sigue autenticado
      if (user.value) setTimeout(connectWs, 5000)
    }

    ws.onmessage = (evt) => {
      try {
        const { eventType, task } = JSON.parse(evt.data)
        // Solo procesar eventos del proyecto actual
        if (task?.projectId && task.projectId !== currentProjectId.value) return
        if (eventType === 'TASK_UPSERTED') upsertTaskLocal(task)
        if (eventType === 'TASK_DELETED')  tasks.value = tasks.value.filter(t => t.taskId !== task.taskId)
      } catch {}
    }

    ws.onerror = (e) => console.warn('WS error:', e)
  }

  function disconnectWs() {
    ws?.close()
    ws = null
    wsConnected.value = false
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function upsertTaskLocal(task) {
    const idx = tasks.value.findIndex(t => t.taskId === task.taskId)
    if (idx >= 0) tasks.value[idx] = task
    else tasks.value.push(task)
  }

  function selectProject(id) {
    currentProjectId.value = id
    loadTasks()
  }

  function addProject(name) {
    const id     = name.toLowerCase().replace(/\s+/g, '-')
    const colors = ['#c77dff', '#4cc9f0', '#f72585', '#7bed9f']
    projects.value.push({
      id, name,
      color: colors[Math.floor(Math.random() * colors.length)]
    })
    selectProject(id)
  }

  return {
    // state
    user, token, tasks, currentProjectId, wsConnected, projects,
    // computed
    isAuthenticated, tasksByStatus, currentProject,
    // actions
    login, register, confirm, logout, loadSession,
    loadTasks, saveTask, deleteTask, moveTask,
    connectWs, disconnectWs,
    selectProject, addProject,
  }
})
```

---

### Archivo 2 — Vista de Auth: `src/views/AuthView.vue`

Maneja login, registro y confirmación. Toma el diseño del `index.html` original.

```vue
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
```

---

### Archivo 3 — Vista del tablero: `src/views/AppView.vue`

El tablero Kanban con sidebar, columnas y modal.

```vue
<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useTaskFlowStore } from '../stores/taskflow'

const taskflow = useTaskFlowStore()
const router   = useRouter()

// Modal state
const showModal   = ref(false)
const modalTask   = ref(null)    // null = nueva tarea, objeto = editar

function openNewTask() {
  modalTask.value = null
  showModal.value = true
}
function openEditTask(task) {
  modalTask.value = { ...task }
  showModal.value = true
}
function closeModal() {
  showModal.value = false
  modalTask.value = null
}

// Form values para el modal
const formTitle    = ref('')
const formDesc     = ref('')
const formStatus   = ref('PENDING')
const formPriority = ref('MEDIUM')
const formTaskId   = ref('')

function openModal(task) {
  if (task) {
    formTaskId.value    = task.taskId
    formTitle.value     = task.title
    formDesc.value      = task.description ?? ''
    formStatus.value    = task.status
    formPriority.value  = task.priority
  } else {
    formTaskId.value    = ''
    formTitle.value     = ''
    formDesc.value      = ''
    formStatus.value    = 'PENDING'
    formPriority.value  = 'MEDIUM'
  }
  showModal.value = true
}

async function saveTask() {
  if (!formTitle.value.trim()) return
  await taskflow.saveTask({
    taskId:      formTaskId.value || undefined,
    title:       formTitle.value,
    description: formDesc.value,
    status:      formStatus.value,
    priority:    formPriority.value,
  })
  closeModal()
}

async function handleLogout() {
  await taskflow.logout()
  router.push('/login')
}

function addProject() {
  const name = prompt('Nombre del proyecto:')
  if (name) taskflow.addProject(name)
}

// Conectar WebSocket y cargar tareas al montar
onMounted(async () => {
  await taskflow.loadTasks()
  taskflow.connectWs()
})

// Desconectar WebSocket al salir de la vista
onUnmounted(() => {
  taskflow.disconnectWs()
})

// Status labels
const statusLabels  = { PENDING: 'Pendiente', IN_PROGRESS: 'En Progreso', DONE: 'Completado' }
const nextStatus    = { PENDING: 'IN_PROGRESS', IN_PROGRESS: 'DONE', DONE: 'PENDING' }
const nextLabel     = { PENDING: '▶ Iniciar', IN_PROGRESS: '✓ Completar', DONE: '↩ Reabrir' }
const priorityClass = { HIGH: 'p-high', MEDIUM: 'p-medium', LOW: 'p-low' }
</script>

<template>
  <div class="app-layout">

    <!-- ── Topbar ────────────────────────────────────────────────────── -->
    <header class="topbar">
      <div class="topbar-brand">Task<span>Flow</span></div>

      <div class="ws-status">
        <div class="ws-dot" :class="{ connected: taskflow.wsConnected }"></div>
        <span>{{ taskflow.wsConnected ? 'LIVE' : 'DISCONNECTED' }}</span>
      </div>

      <div class="topbar-right">
        <div class="user-chip">{{ taskflow.user?.email }}</div>
        <button class="logout-btn" @click="handleLogout">Salir</button>
      </div>
    </header>

    <div class="main">

      <!-- ── Sidebar ──────────────────────────────────────────────────── -->
      <aside class="sidebar">
        <div class="sidebar-section">
          <div class="sidebar-label">Proyectos</div>
          <div
            v-for="p in taskflow.projects"
            :key="p.id"
            class="project-item"
            :class="{ active: p.id === taskflow.currentProjectId }"
            @click="taskflow.selectProject(p.id)"
          >
            <div class="project-dot" :style="{ background: p.color }"></div>
            {{ p.name }}
          </div>
        </div>
        <button class="add-project-btn" @click="addProject">+ Nuevo proyecto</button>
      </aside>

      <!-- ── Board ────────────────────────────────────────────────────── -->
      <main class="board">
        <div class="board-header">
          <h1 class="board-title">
            <span>{{ taskflow.currentProject?.name ?? 'Proyecto' }}</span>
          </h1>
          <button class="new-task-btn" @click="openModal(null)">+ Nueva tarea</button>
        </div>

        <div class="columns">
          <div
            v-for="status in ['PENDING', 'IN_PROGRESS', 'DONE']"
            :key="status"
            class="column"
          >
            <div class="col-header">
              <div class="col-title">
                <div class="col-indicator" :class="status.toLowerCase().replace('_','-')"></div>
                {{ statusLabels[status] }}
              </div>
              <div class="col-count">{{ taskflow.tasksByStatus[status].length }}</div>
            </div>

            <div class="col-body">
              <p v-if="taskflow.tasksByStatus[status].length === 0" class="empty-col">
                — vacío —
              </p>
              <div
                v-for="task in taskflow.tasksByStatus[status]"
                :key="task.taskId"
                class="task-card"
                @click="openModal(task)"
              >
                <div class="task-title">{{ task.title }}</div>
                <div class="task-meta">
                  <span class="priority-badge" :class="priorityClass[task.priority]">
                    {{ task.priority }}
                  </span>
                  <span class="task-project">#{{ task.projectId }}</span>
                </div>
                <div class="task-actions" @click.stop>
                  <button class="task-btn" @click="taskflow.moveTask(task.taskId, nextStatus[status])">
                    {{ nextLabel[status] }}
                  </button>
                  <button class="task-btn del" @click="taskflow.deleteTask(task.taskId)">✕</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>

    <!-- ── Modal ────────────────────────────────────────────────────────── -->
    <div class="modal-overlay" :class="{ open: showModal }" @click.self="closeModal">
      <div class="modal">
        <div class="modal-title">{{ formTaskId ? 'Editar Tarea' : 'Nueva Tarea' }}</div>
        <div class="field">
          <label>Título *</label>
          <input type="text" v-model="formTitle" placeholder="Descripción breve" @keyup.enter="saveTask" />
        </div>
        <div class="field">
          <label>Descripción</label>
          <input type="text" v-model="formDesc" placeholder="Detalles opcionales" />
        </div>
        <div class="field">
          <label>Estado</label>
          <select class="select-field" v-model="formStatus">
            <option value="PENDING">Pendiente</option>
            <option value="IN_PROGRESS">En Progreso</option>
            <option value="DONE">Completado</option>
          </select>
        </div>
        <div class="field">
          <label>Prioridad</label>
          <select class="select-field" v-model="formPriority">
            <option value="LOW">Baja</option>
            <option value="MEDIUM">Media</option>
            <option value="HIGH">Alta</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary btn-sm" @click="saveTask">Guardar</button>
          <button class="btn btn-ghost btn-sm" @click="closeModal">Cancelar</button>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
/* Los estilos del index.html original, adaptados a scoped */
.app-layout { min-height: 100vh; background: var(--bg); }

.topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 32px; height: 56px; background: var(--surface);
  border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 10;
}
.topbar-brand { font-size: 18px; font-weight: 800; letter-spacing: -0.5px; }
.topbar-brand span { color: var(--accent); }
.ws-status { display: flex; align-items: center; gap: 8px; font-family: var(--mono); font-size: 11px; color: var(--muted); }
.ws-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); transition: background .3s; }
.ws-dot.connected { background: var(--accent); box-shadow: 0 0 6px var(--accent); }
.topbar-right { display: flex; align-items: center; gap: 16px; }
.user-chip { font-family: var(--mono); font-size: 11px; color: var(--muted); border: 1px solid var(--border); padding: 4px 12px; border-radius: 20px; }
.logout-btn { background: none; border: none; cursor: pointer; color: var(--muted); font-family: var(--mono); font-size: 11px; letter-spacing: 1px; text-transform: uppercase; transition: color .15s; }
.logout-btn:hover { color: var(--accent2); }

.main { display: grid; grid-template-columns: 280px 1fr; min-height: calc(100vh - 56px); }
.sidebar { background: var(--surface); border-right: 1px solid var(--border); padding: 24px 0; display: flex; flex-direction: column; }
.sidebar-section { padding: 0 20px; margin-bottom: 8px; }
.sidebar-label { font-family: var(--mono); font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: var(--muted); padding: 0 8px; margin-bottom: 8px; }
.project-item { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: var(--radius); cursor: pointer; font-size: 14px; font-weight: 600; color: var(--muted); transition: all .15s; }
.project-item:hover { background: var(--border); color: var(--text); }
.project-item.active { background: rgba(0,229,192,.08); color: var(--accent); border-left: 2px solid var(--accent); }
.project-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.add-project-btn { display: flex; align-items: center; gap: 8px; padding: 9px 20px; font-family: var(--mono); font-size: 12px; color: var(--muted); cursor: pointer; border: none; background: none; width: 100%; text-align: left; transition: color .15s; }
.add-project-btn:hover { color: var(--accent); }

.board { padding: 32px; overflow-y: auto; }
.board-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
.board-title { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
.board-title span { color: var(--accent); }
.new-task-btn { display: flex; align-items: center; gap: 8px; background: var(--accent); color: #000; font-family: var(--mono); font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; padding: 10px 20px; border: none; border-radius: var(--radius); cursor: pointer; transition: all .15s; }
.new-task-btn:hover { background: #00ffda; transform: translateY(-1px); }

.columns { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.column { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
.col-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--border); }
.col-title { display: flex; align-items: center; gap: 8px; font-family: var(--mono); font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: var(--muted); }
.col-indicator { width: 6px; height: 6px; border-radius: 50%; }
.col-indicator.pending    { background: var(--muted); }
.col-indicator.in-progress { background: var(--warn); }
.col-indicator.done       { background: var(--accent); }
.col-count { font-family: var(--mono); font-size: 11px; background: var(--border); color: var(--muted); padding: 2px 8px; border-radius: 10px; }
.col-body { padding: 12px; display: flex; flex-direction: column; gap: 10px; min-height: 120px; }
.empty-col { font-family: var(--mono); font-size: 11px; color: var(--muted); text-align: center; padding: 20px 0; }

.task-card { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; cursor: pointer; transition: all .15s; animation: cardIn .2s ease; }
@keyframes cardIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
.task-card:hover { border-color: var(--accent); transform: translateY(-1px); }
.task-title { font-size: 14px; font-weight: 700; margin-bottom: 8px; line-height: 1.3; }
.task-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.priority-badge { font-family: var(--mono); font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; padding: 2px 8px; border-radius: 2px; }
.priority-badge.p-high   { background: rgba(255,77,109,.15); color: var(--accent2); }
.priority-badge.p-medium { background: rgba(255,209,102,.15); color: var(--warn); }
.priority-badge.p-low    { background: rgba(0,229,192,.1); color: var(--accent); }
.task-project { font-family: var(--mono); font-size: 10px; color: var(--muted); }
.task-actions { display: flex; gap: 6px; margin-top: 10px; }
.task-btn { font-family: var(--mono); font-size: 10px; letter-spacing: 1px; text-transform: uppercase; padding: 4px 10px; border: 1px solid var(--border); background: none; color: var(--muted); border-radius: var(--radius); cursor: pointer; transition: all .15s; }
.task-btn:hover { border-color: var(--accent); color: var(--accent); }
.task-btn.del:hover { border-color: var(--accent2); color: var(--accent2); }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.7); display: none; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
.modal-overlay.open { display: flex; }
.modal { background: var(--surface); border: 1px solid var(--border); border-top: 2px solid var(--accent); width: 100%; max-width: 480px; padding: 32px; animation: modalIn .2s ease; }
@keyframes modalIn { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: scale(1); } }
.modal-title { font-size: 18px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 24px; }
.modal-actions { display: flex; gap: 10px; margin-top: 24px; }
</style>
```

---

### Archivo 4 — Variables CSS globales: `src/assets/main.css`

Reemplaza el contenido existente del archivo:

```css
/* ── Variables globales del diseño ─────────────────────────────────────── */
:root {
  --bg:      #0a0a0f;
  --surface: #12121a;
  --border:  #1e1e2e;
  --accent:  #00e5c0;
  --accent2: #ff4d6d;
  --warn:    #ffd166;
  --text:    #e2e2f0;
  --muted:   #5a5a7a;
  --radius:  4px;
  --mono:    'Space Mono', monospace;
  --sans:    'Syne', sans-serif;
}

@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  min-height: 100vh;
}

body::before {
  content: '';
  position: fixed; inset: 0; pointer-events: none; z-index: 0;
  background-image:
    linear-gradient(rgba(0,229,192,.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,229,192,.03) 1px, transparent 1px);
  background-size: 40px 40px;
}

/* Shared form styles */
.field { margin-bottom: 16px; }
.field label {
  display: block; font-family: var(--mono); font-size: 11px;
  color: var(--muted); letter-spacing: 1px; text-transform: uppercase; margin-bottom: 6px;
}
.field input {
  width: 100%; background: var(--bg); border: 1px solid var(--border);
  border-radius: var(--radius); color: var(--text); font-family: var(--mono);
  font-size: 14px; padding: 10px 14px; outline: none; transition: border-color .15s;
}
.field input:focus { border-color: var(--accent); }

.select-field {
  width: 100%; background: var(--bg); border: 1px solid var(--border);
  border-radius: var(--radius); color: var(--text); font-family: var(--mono);
  font-size: 14px; padding: 10px 14px; outline: none; appearance: none;
  transition: border-color .15s;
}
.select-field:focus { border-color: var(--accent); }

.btn {
  display: inline-flex; align-items: center; justify-content: center;
  font-family: var(--mono); font-size: 13px; font-weight: 700;
  letter-spacing: 1px; text-transform: uppercase;
  padding: 12px 24px; border: none; border-radius: var(--radius);
  cursor: pointer; transition: all .15s; width: 100%;
}
.btn-primary { background: var(--accent); color: #000; }
.btn-primary:hover { background: #00ffda; transform: translateY(-1px); }
.btn-ghost {
  background: transparent; color: var(--muted);
  border: 1px solid var(--border); width: auto; margin-top: 12px;
}
.btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
.btn-sm { padding: 10px 20px; font-size: 12px; width: auto; }
```

---

### Archivo 5 — Router: `src/router/index.js`

Reemplaza el contenido del router con protección de rutas:

```javascript
import { createRouter, createWebHistory } from 'vue-router'
import { getCurrentUser } from 'aws-amplify/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/app'
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/AuthView.vue'),
    },
    {
      path: '/app',
      name: 'app',
      component: () => import('../views/AppView.vue'),
      meta: { requiresAuth: true }
    },
  ],
})

// Guard: redirige a /login si la ruta requiere auth y no hay sesión activa
router.beforeEach(async (to) => {
  if (to.meta.requiresAuth) {
    try {
      await getCurrentUser()   // lanza error si no hay sesión
    } catch {
      return '/login'
    }
  }
})

export default router
```

**¿Por qué este guard?** Si el usuario recarga la página en `/app`, Vue Router verifica si hay sesión activa en Cognito antes de renderizar. Si no hay sesión, redirige a `/login` automáticamente.

---

### Archivo 6 — App.vue raíz

Reemplaza `src/App.vue` con una versión limpia sin estilos que interfieran:

```vue
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
```

---

## Paso 4.5 — Conectar al AWS Toolkit de VS Code

Como ya tienes el AWS Toolkit instalado con tu perfil configurado, puedes verificar los recursos desde VS Code antes de hacer deploy.

**En VS Code:**
1. Abre el panel de AWS Toolkit (ícono de AWS en la barra lateral)
2. Expande tu región → **Lambda** → verifica que ves las funciones `taskflow-*`
3. Expande **DynamoDB** → verifica las tablas `taskflow-tasks-prod` y `taskflow-connections-prod`
4. Expande **Cognito** → verifica el User Pool `taskflow-users-prod`

**Para ver los Outputs del stack SAM directamente desde VS Code:**
1. En el Toolkit, expande **CloudFormation**
2. Busca el stack `taskflow`
3. Haz clic derecho → **View Stack Outputs**
4. Copia los valores de `HttpApiEndpoint`, `WebSocketEndpoint`, `UserPoolId`, `UserPoolClientId`

Estos son exactamente los valores que debes poner en `src/amplify-config.js`.

---

## Paso 4.6 — Deploy con Amplify Hosting

Amplify Gen 2 Hosting se conecta a un repositorio Git y hace deploy automático en cada push.

### **Paso 4.6.1: Subir el código a GitHub**

```bash
# Desde la raíz taskflow/
git init
git add .
git commit -m "feat: taskflow serverless app"

# Crear repo en GitHub y conectar
git remote add origin https://github.com/tu-usuario/taskflow.git
git push -u origin main
```

### **Paso 4.6.2: Crear la app en Amplify Hosting desde la consola AWS**

1. Ve a: https://console.aws.amazon.com/amplify/
2. Click **"Create new app"**
3. Selecciona **"Host your web app"**
4. Elige **GitHub** → Autoriza el acceso → Selecciona tu repositorio `taskflow`
5. Branch: `main`
6. Click **"Next"**

### **Paso 4.6.3: Configurar el build**

Amplify detectará Vite automáticamente. Verifica que el `amplify.yml` generado sea:

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - cd frontend
        - npm ci
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: frontend/dist
    files:
      - '**/*'
  cache:
    paths:
      - frontend/node_modules/**/*
```

**¿Por qué `cd frontend`?** Tu repositorio tiene `frontend/` como subcarpeta (junto con `backend/`). Amplify necesita saber desde dónde hacer el build.

7. Click **"Save and deploy"**

Amplify construirá y desplegará. La primera vez tarda ~3 minutos.

### **Paso 4.6.4: Guardar la URL de Amplify**

Al terminar verás algo así:
```
https://main.d1234abcdef.amplifyapp.com
```

### **Paso 4.6.5: Deploy automático en el futuro**

Cada vez que hagas push a `main`:
```bash
git add .
git commit -m "fix: algo"
git push
```
Amplify detecta el push y redeploya automáticamente. Sin comandos adicionales.

---

## Paso 4.7 — Verificar que todo funciona

### Prueba 1: Auth completo
1. Abre la URL de Amplify en el browser
2. Haz click en **Regístrate**
3. Ingresa email y contraseña (mín. 8 chars, 1 mayúscula, 1 número)
4. Revisa el email y copia el código de verificación
5. Pégalo en el formulario de confirmación
6. Inicia sesión con las credenciales creadas
7. ✅ Deberías ver el tablero Kanban

### Prueba 2: CRUD de tareas
1. Click en **+ Nueva tarea**
2. Llena el formulario y guarda
3. ✅ La tarea aparece en la columna "Pendiente"
4. Click en **▶ Iniciar** — la tarea pasa a "En Progreso"
5. Click en **✓ Completar** — la tarea pasa a "Completado"

### Prueba 3: WebSocket en tiempo real
1. Abre la app en **dos ventanas del browser** (o en modo incógnito)
2. Inicia sesión en ambas
3. En la ventana 1, crea una tarea nueva
4. ✅ La tarea debe aparecer en la ventana 2 automáticamente sin recargar
5. El indicador **LIVE** debe estar verde en ambas ventanas

---

## Troubleshooting

### ❌ Error: "UserPoolId no válido" al hacer login

**Causa:** Los valores en `amplify-config.js` no coinciden con el User Pool real.

**Solución:** Obtener los valores directamente del stack:
```bash
aws cloudformation describe-stacks --stack-name taskflow \
  --query 'Stacks[0].Outputs'
```
Copiar `UserPoolId` y `UserPoolClientId` y actualizar `amplify-config.js`.

---

### ❌ Las tareas no cargan (error 401 en la consola del browser)

**Causa:** El token expiró o la URL de la API es incorrecta.

**Solución:**
1. Verificar que `apiConfig.httpApi` en `amplify-config.js` es exactamente el Output `HttpApiEndpoint` del deploy SAM (sin `/` al final)
2. Cerrar sesión y volver a iniciar para obtener un token fresco

---

### ❌ WebSocket se conecta pero no llegan los mensajes en tiempo real

**Causa:** El Authorizer del WebSocket espera el token en el header `Authorization`, pero los browsers no permiten headers custom en WebSocket nativo. Hay que ajustar el Authorizer para leer el token del query param.

**Solución:** Actualiza `backend/lambdas/authorizer/handler.py`, busca la línea donde lee el token:

```python
# ANTES (lee del header)
auth_header = (event.get("headers") or {}).get("Authorization", "")

# DESPUÉS (lee del header O del query param)
auth_header = (event.get("headers") or {}).get("Authorization", "")
if not auth_header:
    # WebSocket desde browser pasa el token como ?token=xxx
    auth_header = (event.get("queryStringParameters") or {}).get("token", "")
```

Luego re-deploya:
```bash
cd backend && sam build && sam deploy
```

---

### ❌ Amplify build falla con "Cannot find module"

**Causa:** El `amplify.yml` no tiene el `cd frontend` antes del build.

**Solución:** En la consola de Amplify → tu app → **Build settings** → edita el `amplify.yml` y asegúrate que incluye `cd frontend` en la fase `preBuild`.

---

### ❌ Al recargar `/app` redirige al login aunque sí tenía sesión

**Causa:** `loadSession()` en `App.vue` está fallando silenciosamente.

**Diagnóstico:** Abre la consola del browser y busca errores de Amplify. El más común es que `amplifyConfig` en `main.js` no está cargando antes de que Vue intente restaurar la sesión.

**Solución:** Verificar que en `main.js` el `Amplify.configure(amplifyConfig)` está **antes** de `app.mount('#app')`.

---

## 🎯 Estructura final de archivos

```
frontend/
├── amplify/
│   └── backend.ts             ← Amplify Gen 2 (hosting only)
├── src/
│   ├── assets/
│   │   └── main.css           ← Variables CSS globales del diseño
│   ├── stores/
│   │   └── taskflow.js        ← Pinia store: auth + tareas + WebSocket
│   ├── views/
│   │   ├── AuthView.vue       ← Login / Register / Confirm
│   │   └── AppView.vue        ← Tablero Kanban completo
│   ├── router/
│   │   └── index.js           ← Rutas con guard de auth
│   ├── amplify-config.js      ← Conexión a Cognito + URLs de APIs
│   ├── App.vue                ← Restaura sesión al recargar
│   └── main.js                ← Inicializa Amplify + Vue
├── amplify.yml                ← Build config para Amplify Hosting
├── index.html
├── vite.config.js
└── package.json
```
