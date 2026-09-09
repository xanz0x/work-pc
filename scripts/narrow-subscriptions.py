#!/usr/bin/env python3
"""AR-1 · перевод экрана с фасада useVault() на точечные подписки.

Разовый инструмент миграции: заменяет `const v = useVault()` на набор
узких хуков и переписывает обращения `v.<поле>` на нужный домен.
Оставлен в репозитории, чтобы следующие экраны переводились так же.
"""
import re
import sys
from pathlib import Path

DOMAINS = {
    'D': ('useDataStore', """files views fileById viewById addFiles applyIndexed setIndexing
        dropIndexed setReindexHandler removeFile retagFile reindexAll clearIndex wipeVault notes
        liveNotes notesFor addNote patchNote burnNote extendNote sessions activeSessionId
        setActiveSession addSession patchSession removeSession drafts setDraft scrolls setScroll
        graph clusters mix neighbors stats"""),
    'NAV': ('useNavStore', """screen go fileFocus noteFocus clusterFocus nodeFocus settingFocus
        secretFocus openFile openNote openOnMap openCluster openSetting openSecret openSession
        openNotif secretIndex setSecretIndex query setQuery scope setScope hits matchedFiles
        palette setPalette runHit"""),
    'LK': ('useLockStore', """lock lockEpoch fileKeysCount setupLock changeMaster disableLock
        lockNow unlock completeUnlock setAutoLock resetLock"""),
    'ST': ('useSettingsStore', """settings draftSettings setDraftSettings dirty saveSettings
        revertSettings engineView grantCloudConsent revokeCloudConsent setToggle setFolder"""),
    'NT': ('useNotifsStore', """notifs unread notify markAllRead toggleRead snoozeNotif
        muteNotifCat archiveNotif restoreNotif deleteNotif clearRead clearAllNotifs purgeArchive
        notifUndo undoNotifs"""),
}
FIELD_TO_PREFIX = {
    f: prefix for prefix, (_, fields) in DOMAINS.items() for f in fields.split()
}

ANCHOR = '  const v = useVault()'


def convert(path: Path) -> None:
    src = path.read_text(encoding='utf-8')
    parts = src.split(ANCHOR)
    out = [parts[0]]

    for chunk in parts[1:]:
        # границы компонента = до следующего анкера (split уже разрезал)
        used: dict[str, set[str]] = {}
        toast_fields: set[str] = set()

        def repl(m: re.Match[str]) -> str:
            field = m.group(1)
            if field in ('toast', 'flash'):
                toast_fields.add(field)
                return field
            prefix = FIELD_TO_PREFIX.get(field)
            if not prefix:
                return m.group(0)
            used.setdefault(prefix, set()).add(field)
            return f'{prefix}.{field}'

        body = re.sub(r'\bv\.([a-zA-Z]+)\b', repl, chunk)

        # `const { graph, stats } = v` — распределяем по домену первого поля
        def repl_destruct(m: re.Match[str]) -> str:
            fields = [f.strip() for f in m.group(1).split(',') if f.strip()]
            groups: dict[str, list[str]] = {}
            for f in fields:
                prefix = FIELD_TO_PREFIX.get(f)
                if not prefix:
                    return m.group(0)
                groups.setdefault(prefix, []).append(f)
                used.setdefault(prefix, set()).add(f)
            return '\n'.join(
                f'  const {{ {", ".join(fs)} }} = {p}' for p, fs in groups.items()
            )

        body = re.sub(r'  const \{ ([^}]+) \} = v\n', lambda m: repl_destruct(m) + '\n', body)

        decls = []
        for prefix, (hook, _) in DOMAINS.items():
            if prefix in used:
                decls.append(f'  const {prefix} = {hook}()')
        if toast_fields:
            decls.append(f'  const {{ {", ".join(sorted(toast_fields))} }} = useToast()')
        out.append('\n'.join(decls) + body)

    text = ''.join(out)
    text = text.replace(
        "import { useVault, useNow } from '@/lib/vault-store'",
        "import {\n  useDataStore,\n  useLockStore,\n  useNavStore,\n  useNotifsStore,\n"
        "  useNow,\n  useSettingsStore,\n  useToast,\n} from '@/lib/vault-store'",
    ).replace(
        "import { useVault } from '@/lib/vault-store'",
        "import {\n  useDataStore,\n  useLockStore,\n  useNavStore,\n  useNotifsStore,\n"
        "  useSettingsStore,\n  useToast,\n} from '@/lib/vault-store'",
    )
    path.write_text(text, encoding='utf-8')
    print(f'{path}: переведён на узкие подписки')


if __name__ == '__main__':
    for arg in sys.argv[1:]:
        convert(Path(arg))
