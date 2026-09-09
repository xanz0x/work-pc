/* NF-7 · публичный вход модуля бэкапа. */

export {
  ALL_MODULE_IDS,
  APP_BUILD,
  MODULES,
  itemsIn,
  moduleLabel,
  moduleOf,
  type BackupModule,
  type ModuleId,
} from './registry'
export {
  SNAPSHOT_KIND,
  collectSnapshot,
  isSnapshotPayload,
  summarize,
  type LiveState,
  type ModuleData,
  type ModuleSummary,
  type SnapshotPayload,
  type SnapshotSummary,
} from './snapshot'
export { createSnapshot, openSnapshot, type CreatedSnapshot } from './create'
export { restoreSnapshot, type RestoreMode, type RestoreReport } from './restore'
export {
  BACKUP_CONFIG_KEY,
  BACKUP_INDEX_KEY,
  DEFAULT_BACKUP_CONFIG,
  FILE_EXT,
  FILE_KIND,
  KEEP_CHOICES,
  SNAP_PREFIX,
  forgetPassword,
  listSnapshots,
  parseSnapshotFile,
  readConfig,
  readSnapshot,
  recallPassword,
  rememberPassword,
  removeSnapshot,
  saveSnapshot,
  snapshotFile,
  writeConfig,
  type BackupConfig,
  type Schedule,
  type SnapshotFile,
  type SnapshotMeta,
} from './store'
export {
  DAY_MS,
  WEEK_MS,
  intervalOf,
  isDue,
  nextDueAt,
  runDueBackup,
  scheduleLabel,
  type DueResult,
} from './schedule'
export { applyKeyMaterial, collectKeyMaterial, type KeyMaterial, type KeyReport } from './keys'
export { liveOf } from './live'
