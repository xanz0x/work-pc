#!/usr/bin/env python3
"""AR-2 · разрез app/globals.css на базу + слои экранов.

Как режем
---------
1. Монолит (снимок в app/styles/_monolith.css) разбирается на правила.
2. Каждое правило уходит к экрану, если в его селекторе есть класс,
   который встречается ТОЛЬКО в разметке этого экрана. Класс, замеченный
   в каркасе (сайдбар, топбар, палитра, замок, статус-бар), делает правило
   базовым: каркас рендерится всегда, его стили не имеют права уезжать
   в ленивый чанк.
3. Каскад сохраняется честно: каждому исходному блоку монолита выдан
   именованный слой (`@layer wfNNN`), а порядок слоёв объявлен один раз
   в базе. Правило экрана, которое в монолите переопределялось блоком
   полиша ниже, продолжает ему проигрывать — независимо от порядка,
   в котором браузер догрузит файлы.

Запуск: python3 scripts/split-css.py --write
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STYLES = ROOT / 'app' / 'styles'
MONOLITH = STYLES / '_monolith.css'
BASE_OUT = ROOT / 'app' / 'globals.css'

# Границы блоков монолита (строка начала) — только для имён слоёв: внутри
# блока каждое правило распределяется по разметке, а не по номеру строки.
BLOCK_STARTS = [
    1, 2120, 2327, 2846, 3986, 4524, 4849, 5488, 5694, 5738, 6021, 6110, 6562,
    6672, 7136, 7278, 7634, 7735, 8054, 8188, 8235, 8265, 8297, 8309, 8362,
    8433, 8469, 8513, 8564, 8593, 8640, 8690, 8741, 9597, 10050, 10274, 10438,
    10597, 10936, 11042, 11413, 11591, 12294, 12472, 12539, 12907, 13171, 13344,
]

# Разметка экранов: чей класс — того и правило.
SCREEN_FILES = {
    'library': ['components/screen-library.tsx', 'components/library-board.tsx',
                'components/index-strip.tsx'],
    'map': ['components/screen-map.tsx'],
    'chat': ['components/screen-chat.tsx', 'components/chat'],
    'settings': ['components/screen-settings.tsx', 'components/security-section.tsx',
                 'components/secrets-section.tsx', 'components/journal-panel.tsx',
                 'components/flags-section.tsx', 'components/ui-scale-section.tsx'],
    'vault': ['components/screen-vault.tsx', 'components/vault'],
    'activity': ['components/screen-activity.tsx'],
    'mail': ['components/screen-mail.tsx', 'components/mail'],
}
SHELL_FILES = [
    'components/app-shell.tsx', 'components/command-palette.tsx',
    'components/notifications.tsx', 'components/screen-lock.tsx',
    'components/screen-lock-logo.tsx', 'components/dropdown.tsx',
    'components/mk-fields.tsx', 'components/onboarding.tsx', 'components/sidebar-nav.tsx',
    'components/storage-alert.tsx', 'components/screen-boundary.tsx',
    'components/icons.tsx', 'components/ui', 'app/layout.tsx', 'app/(app)',
    'app/login', 'app/error.tsx', 'app/global-error.tsx', 'app/not-found.tsx',
    'app/loading.tsx', 'components/screens.tsx', 'components/app-splash.tsx',
]

HEAD_IMPORT = "@import 'tailwindcss';"
THEME_RANGE = (53, 58)

TOKEN_RE = re.compile(r'[A-Za-z][\w-]*')
CLASS_RE = re.compile(r'\.(-?[A-Za-z_][\w-]*)')


def tokens_of(paths: list[str]) -> set[str]:
    out: set[str] = set()
    for rel in paths:
        p = ROOT / rel
        files = sorted(p.rglob('*.tsx')) if p.is_dir() else ([p] if p.exists() else [])
        for f in files:
            out |= set(TOKEN_RE.findall(f.read_text(encoding='utf-8')))
    return out


# ---------- разбор CSS ----------

class Node:
    def __init__(self, kind: str, prelude: str, text: str, line: int, children=None):
        self.kind = kind          # 'rule' | 'at' | 'raw'
        self.prelude = prelude
        self.text = text          # для 'raw' — весь текст, для 'rule' — тело
        self.line = line
        self.children = children or []


def parse(css: str, line0: int = 1) -> list[Node]:
    nodes: list[Node] = []
    i = 0
    n = len(css)
    pending = ''
    line = line0

    def bump(chunk: str) -> None:
        nonlocal line
        line += chunk.count('\n')

    while i < n:
        ch = css[i]
        if ch.isspace():
            pending += ch
            bump(ch)
            i += 1
            continue
        if css.startswith('/*', i):
            j = css.find('*/', i)
            j = n if j == -1 else j + 2
            pending += css[i:j]
            bump(css[i:j])
            i = j
            continue
        # начало конструкции
        start_line = line
        head_start = i
        depth = 0
        j = i
        while j < n:
            if css.startswith('/*', j):
                k = css.find('*/', j)
                j = n if k == -1 else k + 2
                continue
            c = css[j]
            if c == '{':
                depth = 1
                break
            if c == ';' and depth == 0:
                break
            j += 1
        if j >= n:
            pending += css[i:]
            break
        if css[j] == ';':  # директива без тела (@import/@layer ...)
            text = css[head_start:j + 1]
            nodes.append(Node('raw', '', pending + text, start_line))
            bump(text)
            pending = ''
            i = j + 1
            continue
        prelude = css[head_start:j].strip()
        body_start = j + 1
        k = body_start
        depth = 1
        while k < n and depth > 0:
            if css.startswith('/*', k):
                e = css.find('*/', k)
                k = n if e == -1 else e + 2
                continue
            if css[k] == '{':
                depth += 1
            elif css[k] == '}':
                depth -= 1
            k += 1
        body = css[body_start:k - 1]
        whole = css[head_start:k]
        is_at = prelude.startswith('@')
        nested = prelude.startswith(('@media', '@supports', '@layer', '@container'))
        node = Node('at' if nested else 'rule', prelude, body, start_line)
        node.raw_prefix = pending  # type: ignore[attr-defined]
        node.whole = whole  # type: ignore[attr-defined]
        if nested:
            bl = start_line + css[head_start:body_start].count('\n')
            node.children = parse(body, bl)
        elif is_at:
            node.kind = 'rule'  # @keyframes/@font-face — цельный кусок
        nodes.append(node)
        bump(whole)
        pending = ''
        i = k
    if pending.strip():
        nodes.append(Node('raw', '', pending, line))
    return nodes


# ---------- распределение ----------

def target_of_selector(prelude: str, own: dict[str, set[str]], shell: set[str]) -> str:
    classes = CLASS_RE.findall(prelude)
    if not classes:
        return 'base'
    hits = set()
    for c in classes:
        if c in shell:
            return 'base'
        for screen, names in own.items():
            if c in names:
                hits.add(screen)
    if len(hits) == 1:
        return hits.pop()
    return 'base'


def assign(nodes: list[Node], own, shell) -> list[tuple[str, str, int]]:
    """-> [(target, text, line)] в исходном порядке."""
    out = []
    for nd in nodes:
        prefix = getattr(nd, 'raw_prefix', '')
        if nd.kind == 'raw':
            out.append(('base', nd.text, nd.line))
        elif nd.kind == 'rule':
            t = target_of_selector(nd.prelude, own, shell)
            out.append((t, prefix + nd.whole, nd.line))  # type: ignore[attr-defined]
        else:  # @media / @supports
            inner = assign(nd.children, own, shell)
            groups: dict[str, list[str]] = {}
            for t, text, _ in inner:
                groups.setdefault(t, []).append(text)
            if len(groups) == 1:
                t = next(iter(groups))
                out.append((t, prefix + nd.whole, nd.line))  # type: ignore[attr-defined]
            else:
                for t, chunks in groups.items():
                    body = ''.join(chunks)
                    if not body.strip():
                        continue
                    out.append((t, f'{prefix}{nd.prelude} {{\n{body}\n}}\n', nd.line))
    return out


def layer_of(line: int) -> str:
    idx = 0
    for i, start in enumerate(BLOCK_STARTS):
        if line >= start:
            idx = i
    return f'wf{idx + 1:03d}'


def indent(text: str) -> str:
    return ''.join(('  ' + ln if ln.strip() else ln) for ln in text.splitlines(keepends=True))


def main() -> int:
    css = MONOLITH.read_text(encoding='utf-8')
    lines = css.splitlines(keepends=True)
    theme = ''.join(lines[THEME_RANGE[0] - 1:THEME_RANGE[1]])

    shell = tokens_of(SHELL_FILES)
    own = {k: tokens_of(v) for k, v in SCREEN_FILES.items()}
    # класс, встреченный у двух экранов, экранным не считается
    for a in own:
        for b in own:
            if a != b:
                shell |= own[a] & own[b]

    nodes = parse(css)
    pieces = assign(nodes, own, shell)

    # склеиваем последовательные куски одного файла и одного слоя
    files: dict[str, list[str]] = {}
    last: dict[str, str] = {}
    for target, text, line in pieces:
        if text.strip() in ('', HEAD_IMPORT) or text.strip().startswith('@import'):
            continue
        if THEME_RANGE[0] <= line <= THEME_RANGE[1] and text.lstrip().startswith('@theme'):
            continue
        layer = layer_of(line)
        buf = files.setdefault(target, [])
        if last.get(target) == layer:
            buf[-1] += text
        else:
            buf.append(f'@@LAYER:{layer}@@' + text)
            last[target] = layer

    def render(chunks: list[str]) -> str:
        out = []
        for c in chunks:
            layer, body = c[len('@@LAYER:'):].split('@@', 1)
            out.append(f'@layer {layer} {{\n{indent(body)}\n}}\n')
        return '\n'.join(out)

    order = ', '.join(f'wf{i + 1:03d}' for i in range(len(BLOCK_STARTS)))
    header = (
        f'{HEAD_IMPORT}\n\n'
        '/* ============================================================\n'
        '   WORKFLOW · БАЗОВЫЙ СЛОЙ (AR-2)\n'
        '   Монолит на 12 538 строк разрезан на базу и слои экранов\n'
        '   (app/styles/screen-*.css): правила экрана приезжают вместе с его\n'
        '   чанком. Порядок каскада задан объявлением слоёв ниже и повторяет\n'
        '   порядок блоков монолита, поэтому переопределения работают так же,\n'
        '   как до разреза.\n'
        '   Правка: меняем app/styles/_monolith.css и гоняем\n'
        '   `python3 scripts/split-css.py --write` (проверка разреза —\n'
        '   scripts/check-css-split.py).\n'
        '   ============================================================ */\n\n'
        f'@layer {order};\n\n'
        f'{theme}\n'
    )

    if '--write' not in sys.argv:
        for t, chunks in files.items():
            print(t, len(render(chunks).splitlines()))
        return 0

    BASE_OUT.write_text(header + render(files['base']), encoding='utf-8')
    print(f'globals.css: {len(BASE_OUT.read_text(encoding="utf-8").splitlines())} строк')
    for target, chunks in files.items():
        if target == 'base':
            continue
        body = (
            f'/* AR-2 · слой экрана «{target}»: приезжает вместе с чанком экрана.\n'
            '   Сгенерирован scripts/split-css.py из app/styles/_monolith.css —\n'
            '   правки вносим в монолит, а не здесь. */\n\n'
        ) + render(chunks)
        (STYLES / f'screen-{target}.css').write_text(body, encoding='utf-8')
        print(f'screen-{target}.css: {len(body.splitlines())} строк')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
