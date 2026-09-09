#!/usr/bin/env python3
"""AR-2 · проверка разреза CSS: не уехал ли класс каркаса в слой экрана.

Собираем классы из каждого app/styles/screen-*.css и ищем их в компонентах,
которые живут в каркасе (он рендерится всегда, его CSS обязан быть в базе).
Любая находка — повод перенести правило назад в базу.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHELL = [
    'components/app-shell.tsx',
    'components/sidebar-nav.tsx',
    'components/command-palette.tsx',
    'components/notifications.tsx',
    'components/screen-lock.tsx',
    'components/screen-lock-logo.tsx',
    'components/dropdown.tsx',
    'components/storage-alert.tsx',
    'components/screen-boundary.tsx',
    'components/ui',
    'app/layout.tsx',
    'app/login',
    'app/error.tsx',
    'app/global-error.tsx',
    'app/not-found.tsx',
    'app/loading.tsx',
]

CLASS_RE = re.compile(r'\.([a-zA-Z][\w-]*)')


def shell_text() -> str:
    parts = []
    for rel in SHELL:
        p = ROOT / rel
        if p.is_dir():
            for f in p.rglob('*.tsx'):
                parts.append(f.read_text(encoding='utf-8'))
        elif p.exists():
            parts.append(p.read_text(encoding='utf-8'))
    return '\n'.join(parts)


def main() -> int:
    text = shell_text()
    used = set(re.findall(r'[\w-]+', text))
    bad = {}
    for css in sorted((ROOT / 'app' / 'styles').glob('screen-*.css')):
        classes = set(CLASS_RE.findall(css.read_text(encoding='utf-8')))
        hit = sorted(c for c in classes if c in used)
        if hit:
            bad[css.name] = hit
    for name, hit in bad.items():
        print(f'{name}: {len(hit)} классов встречаются в каркасе')
        print('   ', ', '.join(hit))
    if not bad:
        print('чисто: классы каркаса остались в базе')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
