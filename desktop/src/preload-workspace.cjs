const { contextBridge, ipcRenderer } = require('electron')

/**
 * Мост workspace-окна (контракт в .hermes/plans/2026-09-06-features.md §7).
 * Страница зовёт window.workspacexDesktop; реальные действия и проверки
 * путей/ссылок живут в главном процессе (main.mjs, handleWorkspace).
 * Ответы приходят как { ok, data?, error? } — как у setup-моста.
 */
contextBridge.exposeInMainWorld('workspacexDesktop', {
  /** Открыть ссылку в браузере по умолчанию. Разрешено только http(s). */
  openExternal: (url) => ipcRenderer.invoke('workspacex:open-external', String(url ?? '')),
  /** Показать файл/папку в проводнике (explorer /select). Только внутри папки хранения. */
  revealInExplorer: (absPath) => ipcRenderer.invoke('workspacex:reveal', String(absPath ?? '')),
  /** Открыть файл/папку средствами Windows. Только внутри папки хранения. */
  openPath: (absPath) => ipcRenderer.invoke('workspacex:open-path', String(absPath ?? '')),
  /** Системный диалог выбора папки хранения. Возвращает путь или null при отмене. */
  pickFolder: () => ipcRenderer.invoke('workspacex:pick-folder'),
  /**
   * ПКМ внутри письма: тело письма — iframe с sandbox без скриптов, поэтому
   * событие context-menu до React не доходит. Главный процесс ловит его на
   * webContents и пересылает сюда; callback снимается вызванной функцией.
   */
  onContextMenu: (callback) => {
    const handler = (_event, value) => callback(value)
    ipcRenderer.on('workspacex:context-menu', handler)
    return () => ipcRenderer.removeListener('workspacex:context-menu', handler)
  },
})
