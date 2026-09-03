/* ============================================================
   NF-7 · ЖИВОЕ СОСТОЯНИЕ ДЛЯ СНИМКА
   `usePersistedState` пишет документ только при изменении, поэтому
   демо-набор первого запуска живёт на значениях по умолчанию и в
   хранилище его нет. Снимок обязан содержать то, что человек ВИДИТ,
   иначе после «Удалить сейф» и восстановления он потеряет ровно эти
   данные. Здесь единственное место, где бэкап знает про стор.
   ============================================================ */

import type { VaultCtx } from '@/lib/vault-store'
import type { LiveState } from './snapshot'

export function liveOf(v: VaultCtx): LiveState {
  return {
    'wf.files.v1': v.files,
    'wf.notes.v1': v.notes,
    'wf.chat.v1': v.sessions,
    'wf.settings.v1': v.settings,
    'wf.notifs.v1': v.notifs,
  }
}
