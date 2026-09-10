'use client'

/* ============================================================
   БИБЛИОТЕКА · ИНСПЕКТОР ФАЙЛА
   Правая колонка для выбранного файла: превью, место хранения
   (моя папка / общий диск), метаданные, описание ИИ, стикеры,
   связи и действия — просмотр, открыть на ПК, карта, удаление.
   Вынесено из screen-library.tsx без изменения поведения.
   ============================================================ */

import {
  IconDatabase,
  IconDoc,
  IconDocPreview,
  IconExternal,
  IconFolder,
  IconGraph,
  IconLock,
  IconLockRound,
  IconPencil,
  IconPlus,
  IconSticker,
  IconTrash,
} from './icons'
import { BRIDGE_HINT, REASON_LABEL, absPathOf, desktopBridge } from './library-shared'
import type { LibraryShareRequest } from './library-share-dialog'
import { fmtBytes, type FileView } from '@/lib/data'
import { fmtLeft, type Note } from '@/lib/notes'
import type { useFileKeys } from '@/hooks/use-file-keys'
import { useDataStore, useNavStore } from '@/lib/vault-store'
import type { neighborsOf } from '@/lib/graph'

type Sel = { kind: 'file' | 'note'; id: string }
type Layer = 'all' | 'files' | 'notes'

export function LibraryFileInspector({
  selFile,
  tab,
  setTab,
  isAdmin,
  fk,
  now,
  view,
  setView,
  setSel,
  related,
  pinnedToSel,
  fkGatedSelFile,
  selFileAbsPath,
  selFileBridgeReady,
  setCloudPreview,
  setCloudShared,
  setShareRequest,
  openFileTile,
  startNew,
  setFkAsk,
  setFkVal,
  setFkErr,
  setFkCooldownUntil,
  setFkSetFor,
  setFkNew1,
  setFkNew2,
  setFkSetErr,
}: {
  /** Выбранный файл; пусто — инспектор показывает прочерки. */
  selFile: FileView | undefined
  tab: 'details' | 'ai'
  setTab: (t: 'details' | 'ai') => void
  isAdmin: boolean
  fk: ReturnType<typeof useFileKeys>
  now: number
  view: Layer
  setView: (v: Layer) => void
  setSel: (s: Sel) => void
  related: ReturnType<typeof neighborsOf>
  pinnedToSel: Note[]
  /** Описание файла заперто файловым ключом. */
  fkGatedSelFile: boolean
  selFileAbsPath: string | null
  selFileBridgeReady: boolean
  setCloudPreview: (f: FileView | null) => void
  setCloudShared: (cloudId: string, shared: boolean) => Promise<void> | void
  setShareRequest: (r: LibraryShareRequest) => void
  openFileTile: (id: string) => void
  startNew: (pinToFileId?: string) => void
  setFkAsk: (id: string | null) => void
  setFkVal: (v: string) => void
  setFkErr: (v: string | null) => void
  setFkCooldownUntil: (v: number) => void
  setFkSetFor: (id: string | null) => void
  setFkNew1: (v: string) => void
  setFkNew2: (v: string) => void
  setFkSetErr: (v: string | null) => void
}) {
  const D = useDataStore()
  const NAV = useNavStore()
  const { stats } = D

  return (
    <aside className="inspector panel fade-in" aria-label="Инспектор файла">
      <div className="insp-tabs">
        <button
          className={`insp-tab${tab === 'details' ? ' on' : ''}`}
          onClick={() => setTab('details')}
          aria-pressed={tab === 'details'}
        >
          Детали
        </button>
        <button
          className={`insp-tab${tab === 'ai' ? ' on' : ''}`}
          onClick={() => setTab('ai')}
          aria-pressed={tab === 'ai'}
        >
          ИИ-анализ
        </button>
      </div>

      <div className="preview panel">
        <IconDocPreview width={44} height={44} stroke="currentColor" strokeWidth={1.2} />
        {selFile?.pages ? (
          <span className="chip page-badge num">СТР 1/{selFile.pages}</span>
        ) : null}
      </div>

      <div className="file-name mono num">{selFile?.name ?? '—'}</div>

      {selFile?.shared && (
        <div className="insp-block panel" data-testid="insp-cloud">
          <div className="blk-head">
            <span className="label-mono">{selFile.cloudShared === false ? 'Моя папка на ПК' : 'Общий диск'}</span>
            <span
              className="chip"
              style={
                selFile.cloudShared === false
                  ? { borderColor: 'var(--line)', color: 'var(--muted)' }
                  : { borderColor: 'var(--accent-line)', color: 'var(--accent)' }
              }
            >
              {selFile.cloudShared === false ? 'личный' : 'облако'}
            </span>
          </div>
          <p>
            {selFile.cloudShared === false
              ? 'Файл лежит в вашей локальной папке на этом ПК и виден только вам. В общую папку он попадёт, только если вы добавите его сами.'
              : 'Файл в общей папке — его видят все участники. В библиотеке и на карте он помечен «общий диск».'}
          </p>
          <div className="insp-actions">
            <button className="btn btn-primary btn-sm" data-testid="insp-cloud-view" onClick={() => setCloudPreview(selFile)}>
              <IconDocPreview />
              Просмотр
            </button>
            <a
              className="btn btn-ghost btn-sm"
              href={`/ai-api/cloud/file/${selFile.cloudId}`}
              data-testid="insp-cloud-download"
            >
              <IconExternal />
              Скачать
            </a>
            {isAdmin ? (
              <>
                <button
                  className="btn btn-ghost btn-sm"
                  data-testid="insp-cloud-toggle-shared"
                  onClick={() => {
                    if (!selFile?.cloudId) return
                    void setCloudShared(selFile.cloudId, selFile.cloudShared === false)
                  }}
                >
                  <IconDatabase />
                  {selFile.cloudShared === false ? 'Добавить в общую папку' : 'Убрать из общей папки'}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  data-testid="insp-cloud-delete"
                  onClick={() => {
                    if (!selFile?.cloudId) return
                    setShareRequest({ mode: 'remove', kind: 'file', id: selFile.id, title: selFile.name, cloudId: selFile.cloudId })
                  }}
                >
                  <IconTrash />
                  Удалить файл
                </button>
              </>
            ) : (
              <span className="setting-note" data-testid="insp-cloud-readonly">только просмотр · удаление у администратора</span>
            )}
          </div>
        </div>
      )}

      {selFile && !selFile.shared && (
        /* Просмотр локального файла: раньше открывался только правой
           кнопкой по карточке — кнопка делает путь очевидным. */
        <div className="insp-actions">
          <button
            className="btn btn-ghost btn-sm"
            data-testid="insp-file-view"
            onClick={() => (fk.isProtected(selFile.id) && !fk.isOpen(selFile.id) ? openFileTile(selFile.id) : setCloudPreview(selFile))}
          >
            <IconDocPreview />
            Просмотр
          </button>
        </div>
      )}

      {tab === 'details' ? (
        <div className="meta-grid">
          <div>
            <span className="label-mono">Размер</span>
            <div className="v num">{selFile ? fmtBytes(selFile.bytes) : '—'}</div>
          </div>
          <div>
            <span className="label-mono">Добавлен</span>
            <div className="v num">{selFile?.date ?? '—'}</div>
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <span className="label-mono">Кластер</span>
            <div className="badges-row">
              <button
                className="chip chip-cat chip-btn"
                onClick={() => selFile && NAV.openCluster(selFile.cluster)}
                disabled={!selFile}
              >
                {selFile?.cat ?? '—'}
              </button>
            </div>
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <span className="label-mono">Безопасность</span>
            <div className="badges-row">
              <span className="badge badge-ok">
                <IconLock />
                {stats.offline ? 'локально' : 'есть исходящие'}
              </span>
              <span className="badge badge-info">
                <IconLock />
                зашифровано
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="insp-block panel">
          <div className="blk-head">
            <span className="label-mono">Оценка ИИ</span>
            <span className="chip">
              модель <span className="num">{stats.model}</span>
            </span>
          </div>
          <p>
            {selFile?.processing
              ? 'Файл ещё разбирается на устройстве: как только модель дочитает его, здесь появятся тип, ключевые сущности и связи.'
              : `Файл отнесён к кластеру «${selFile?.cat ?? '—'}». Найдено ${related.length} смысловых связей: ${
                  related.filter((r) => r.reason === 'tag').length
                } по общим меткам, ${
                  related.filter((r) => r.reason === 'pin').length
                } через приколотые стикеры.`}
          </p>
        </div>
      )}

      <div className="insp-block panel">
        <div className="blk-head">
          <span className="label-mono">Описание ИИ</span>
          <IconPencil width={13} height={13} stroke="currentColor" strokeWidth={1.5} />
        </div>
        <p>
          {selFile && fkGatedSelFile
            ? 'Содержимое под файловым ключом. Введите ключ, чтобы расшифровать описание.'
            : selFile?.processing
              ? 'Описание появится после локального разбора.'
              : (selFile?.desc ?? 'Файл не выбран.')}
        </p>
        {fkGatedSelFile && (
          <div className="badges-row">
            <span className="fk-badge">
              <IconLockRound width={10} height={10} stroke="currentColor" strokeWidth={1.6} />
              под ключом
            </span>
          </div>
        )}
      </div>

      <div className="insp-block panel">
        <div className="blk-head">
          <span className="label-mono">Приколотые стикеры</span>
          <span className="chip num">{pinnedToSel.length}</span>
        </div>
        {pinnedToSel.length > 0 ? (
          pinnedToSel.map((n) => (
            <button
              key={n.id}
              className="rel-item pin-item"
              onClick={() => {
                if (view === 'files') setView('all')
                setSel({ kind: 'note', id: n.id })
              }}
            >
              <IconSticker width={14} height={14} stroke="currentColor" strokeWidth={1.5} />
              <span className="rn ellipsis">{n.title}</span>
              <span className="rp mono num">
                {n.expiresAt === null ? '∞' : fmtLeft(n.expiresAt - now)}
              </span>
            </button>
          ))
        ) : (
          <p>К этому файлу пока нет стикеров. Напишите первый — он будет виден рядом.</p>
        )}
        <button
          className="btn btn-ghost btn-sm btn-full pin-add"
          onClick={() => startNew(selFile?.id)}
          disabled={!selFile}
        >
          <IconPlus />
          Приколоть стикер
        </button>

        {/* Этап 5: файловый ключ — пароль ×2, wrapped мастер-ключом (п.4). */}
        <button
          className="btn btn-ghost btn-sm btn-full pin-add"
          data-testid="fk-set-open"
          onClick={() => {
            setFkSetFor(selFile?.id ?? null)
            setFkNew1('')
            setFkNew2('')
            setFkSetErr(null)
          }}
          disabled={!selFile || selFile.shared || fk.isProtected(selFile.id)}
        >
          <IconLockRound width={13} height={13} stroke="currentColor" strokeWidth={1.6} />
          Поставить на ключ
        </button>
      </div>

      {/* Соседи берутся из графа связей, а не из фиксированного списка. */}
      <div className="insp-block panel">
        <div className="blk-head">
          <span className="label-mono">Связаны</span>
          <span className="chip num">{related.length}</span>
        </div>
        {related.length > 0 ? (
          related.map((r) => (
            <button
              key={r.node.id}
              className="rel-item pin-item"
              onClick={() =>
                setSel({ kind: r.node.kind === 'note' ? 'note' : 'file', id: r.node.id })
              }
            >
              {r.node.kind === 'note' ? (
                <IconSticker width={14} height={14} stroke="currentColor" strokeWidth={1.5} />
              ) : (
                <IconDoc width={14} height={14} stroke="currentColor" strokeWidth={1.5} />
              )}
              <span className="rn mono ellipsis">{r.node.label}</span>
              <span className="rp mono num">
                {Math.round(r.w * 100)}% · {REASON_LABEL[r.reason]}
              </span>
            </button>
          ))
        ) : (
          <p>Связей пока нет: у файла нет общих меток и стикеров с другими объектами.</p>
        )}
      </div>

      <div className="insp-actions">
        {/* П.4 плана: «Открыть» раньше ничего не делало — теперь открывает просмотрщик. */}
        <button
          className="btn btn-primary btn-full"
          onClick={() => {
            if (!selFile) return
            if (fkGatedSelFile) {
              /* Файл под ключом: сначала ключ, потом просмотр (как из сетки). */
              setFkAsk(selFile.id)
              setFkVal('')
              setFkErr(null)
              setFkCooldownUntil(0)
              return
            }
            setCloudPreview(selFile)
          }}
          disabled={!selFile}
          data-testid="insp-preview"
        >
          <IconDocPreview />
          Просмотр файла
        </button>
        <button
          className="btn btn-ghost btn-full"
          onClick={() => {
            const abs = absPathOf(selFile)
            const bridge = desktopBridge()
            if (bridge?.openPath && abs) bridge.openPath(abs)
          }}
          disabled={!selFile || !selFileAbsPath || !selFileBridgeReady}
          title={selFileBridgeReady && selFileAbsPath ? 'Открыть файл в программе по умолчанию' : BRIDGE_HINT}
          data-testid="insp-open-pc"
        >
          <IconExternal />
          Открыть на ПК
        </button>
        <button
          className="btn btn-ghost btn-full"
          onClick={() => {
            const abs = selFileAbsPath
            const bridge = desktopBridge()
            if (bridge?.revealInExplorer && abs) bridge.revealInExplorer(abs)
          }}
          disabled={!selFile || !selFileAbsPath || !selFileBridgeReady}
          title={selFileBridgeReady && selFileAbsPath ? 'Показать файл в проводнике' : BRIDGE_HINT}
          data-testid="insp-reveal"
        >
          <IconFolder />
          Показать в папке
        </button>
        <button
          className="btn btn-ghost btn-full"
          onClick={() => selFile && NAV.openOnMap(selFile.id)}
          disabled={!selFile}
        >
          <IconGraph />
          Показать на карте
        </button>
        <button
          className="btn btn-ghost btn-full btn-danger"
          onClick={() => {
            if (!selFile) return
            if (selFile.shared) return
            fk.forgetKey(selFile.id)
            D.removeFile(selFile.id)
          }}
          disabled={!selFile || selFile.shared}
        >
          <IconTrash />
          Удалить из сейфа
        </button>
      </div>
    </aside>
  )
}
