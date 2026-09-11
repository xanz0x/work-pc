const api = window.workspacexSetup
const $ = (id) => document.getElementById(id)
let current = {}
let pickedRole = null /* 'host' | 'client' | null — выбор на шаге 1 */
let submitting = false
let step = 1

/* Фазы активной работы: визард держит шаг 3, пока они идут. */
const ACTIVE_PHASES = ['starting', 'app-ready', 'ready']
const STEP_LABELS = { 1: 'ШАГ 1 ИЗ 4 · РОЛЬ КОМПЬЮТЕРА', 2: 'ШАГ 2 ИЗ 4 · ДАННЫЕ ДОСТУПА', 3: 'ШАГ 3 ИЗ 4 · ЗАГРУЗКА ИИ', 4: 'ШАГ 4 ИЗ 4 · ГОТОВО' }
const DOWNLOAD_PHASES = []

function error(message) { $('error').textContent = message || ''; $('error').hidden = !message }
async function call(fn) {
  error('')
  try { const result = await fn(); if (!result.ok) throw new Error(result.error); return result.data }
  catch (e) { error(e.message); throw e }
}

/* ---------- Шаги визарда ---------- */
function setStep(next) {
  step = next
  $('choice').hidden = step !== 1
  $('host-form').hidden = !(step === 2 && pickedRole === 'host')
  $('client-form').hidden = !(step === 2 && pickedRole === 'client')
  $('configured').hidden = step !== 4
  for (const li of document.querySelectorAll('#steps [data-step]')) {
    const value = Number(li.dataset.step)
    li.classList.toggle('active', value === step)
    li.classList.toggle('done', value < step)
    if (value === step) li.setAttribute('aria-current', 'step')
    else li.removeAttribute('aria-current')
  }
  document.querySelector('[data-testid="setup-step"]').textContent = STEP_LABELS[step]
}

function showRole(role) {
  pickedRole = role
  for (const value of ['host', 'client']) { $(`choose-${value}`).classList.toggle('selected', value === role); $(`choose-${value}`).setAttribute('aria-pressed', String(value === role)) }
  setStep(2)
  error('')
}

/* ---------- Приём состояния из главного процесса ---------- */
function render(update) {
  current = { ...current, ...update }
  if (current.configured) {
    $('connection-role').textContent = current.role === 'host' ? 'ГЛАВНЫЙ ПК' : 'КОМПЬЮТЕР ДРУГА'
    $('connection-url').textContent = current.url
    $('copy-invite').hidden = current.role !== 'host'; $('mail-settings').hidden = current.role !== 'host'
    $('mail-state').textContent = current.mailConfigured ? 'Ключ сохранён. Доступность сервиса проверяется при обращении.' : 'Ключ не указан. Gmail и Outlook недоступны; бесплатная временная почта работает отдельно.'
    if (step !== 4) setStep(4)
  } else if (step < 3 && (submitting || ACTIVE_PHASES.includes(current.phase))) {
    setStep(3)
  }
  /* Панель состояния: шаг 3 целиком; на шаге 4 — пока идёт работа/сервер запускается. */
  $('status-panel').hidden = !(step === 3 || current.configured || current.phase !== 'idle')
  $('status').textContent = current.text
  const total = update.total, completed = update.completed
  const gb = (bytes) => (bytes / 1073741824).toFixed(2).replace('.', ',')
  $('progress').hidden = !total
  $('progress-text').textContent = total ? `${gb(completed)} / ${gb(total)} ГБ · ${Math.min(100, Math.round(completed / total * 100))}%` : ''
  if (total) $('progress').value = Math.min(100, completed / total * 100)
  $('retry').hidden = current.phase !== 'error'
  $('pause').hidden = !DOWNLOAD_PHASES.includes(current.phase)
  $('open').disabled = !current.appReady
  if (current.phase === 'error' && step === 3) error(current.text)
}

async function init() {
  if (!api) { error('Этот мастер работает в установленной программе WorkSpaceX.'); return }
  api.progress(render)
  const data = await call(api.state)
  document.querySelector('[data-testid="setup-hardware"]').textContent = `${data.ramGB} ГБ памяти · ${data.freeGB} ГБ свободно`
  $('version').textContent = `v${data.version}`
  for (const ip of data.addresses) { const option = document.createElement('option'); option.value = ip; $('host-addresses').append(option) }
  $('host').value = data.addresses[0] || ''
  render(data)
}

/* ---------- Шаг 1: роль ---------- */
$('choose-host').onclick = () => showRole('host')
$('choose-client').onclick = () => showRole('client')

/* ---------- Шаг 2: формы ---------- */
$('back-host').onclick = () => { pickedRole = null; setStep(1) }
$('back-client').onclick = () => { pickedRole = null; setStep(1) }

$('host-form').onsubmit = async (e) => {
  e.preventDefault()
  if (submitting) return
  submitting = true; $('create-host').disabled = true
  setStep(3)
  try {
    const data = await call(() => api.createHost({ login: $('login').value, password: $('password').value, confirmPassword: $('confirm-password').value, host: $('host').value, mailKey: $('mail-key').value }))
    render(data)
  } catch { setStep(2) /* сообщение уже показано */ }
  finally { submitting = false; $('create-host').disabled = false }
}

$('client-form').onsubmit = async (e) => {
  e.preventDefault()
  if (submitting) return
  submitting = true; $('join').disabled = true
  setStep(3)
  try { render(await call(() => api.join($('invite').value))) }
  catch { setStep(2) /* сообщение уже показано */ }
  finally { submitting = false; $('join').disabled = false }
}

/* ---------- Шаг 3: загрузка ---------- */
$('retry').onclick = async () => { $('retry').disabled = true; try { await call(api.retry) } catch {} finally { $('retry').disabled = false } }
$('pause').onclick = () => call(api.pause).catch(() => {})
$('open').onclick = async () => { $('open').disabled = true; try { await call(api.open) } catch {} finally { $('open').disabled = !current.appReady } }

/* ---------- Шаг 4: готово ---------- */
$('copy-invite').onclick = async () => { try { await call(api.copyInvite); $('copy-invite').textContent = 'Приглашение скопировано'; setTimeout(() => { $('copy-invite').textContent = 'Скопировать приглашение для друга' }, 2000) } catch {} }
$('update-mail').onclick = async () => { $('update-mail').disabled = true; try { await call(() => api.updateMail($('new-mail-key').value)); $('new-mail-key').value = ''; render(await call(api.state)) } catch {} finally { $('update-mail').disabled = false } }

init().catch(() => {})
