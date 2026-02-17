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