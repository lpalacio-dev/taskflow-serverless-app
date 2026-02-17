import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  signIn, signUp, signOut, confirmSignUp,
  getCurrentUser, fetchAuthSession
} from 'aws-amplify/auth'
import { apiConfig } from '../../amplify-config'

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