/* ============================================================
   UX-5 · ДЕМО-КОРПУС
   Всё, что не принадлежит человеку: показательные файлы, стикеры и
   сохранённый разговор. Модуль намеренно вынесен из основного бандла —
   его подтягивает динамический import() в сторе данных и ТОЛЬКО при
   первом запуске пустого сейфа. Каждый объект помечен `demo: true`,
   поэтому «Начать с чистого сейфа» убирает ровно демо и не трогает
   ничего, что человек добавил или импортировал сам.
   ============================================================ */

import type { VaultFile } from './data'
import { DAY, HOUR, MIN, type Note } from './notes'
import type { Session } from '@/components/chat/types'
import { CHAT_ANSWERS, buildStages, resolveAnswer } from './chat-data'

const KB = 1024
const MB = 1024 * KB

/**
 * Демо-файлы. Байты подобраны так, чтобы совпадать с подписями карточек:
 * размер считается из bytes, а не хранится строкой.
 */
export const DEMO_FILES: VaultFile[] = [
  {
    id: 'rent-2026',
    icon: 'doc',
    cluster: 'docs',
    name: 'договор_аренды_2026.pdf',
    desc: 'Договор аренды офиса на год, подписан 12 февраля',
    bytes: Math.round(4.2 * MB),
    date: '12 фев',
    pages: 18,
    tags: ['документы', 'аренда'],
    demo: true,
  },
  {
    id: 'rent-2025',
    icon: 'doc',
    cluster: 'docs',
    name: 'договор_аренды_2025.pdf',
    desc: 'Прошлогодний договор на то же помещение',
    bytes: Math.round(3.9 * MB),
    date: '14 фев 2025',
    pages: 16,
    tags: ['документы', 'аренда'],
    demo: true,
  },
  {
    id: 'protocol',
    icon: 'docDraft',
    cluster: 'docs',
    name: 'протокол_разногласий.pdf',
    desc: 'Правки к договору аренды, согласованы обеими сторонами',
    bytes: 640 * KB,
    date: '13 фев',
    pages: 6,
    tags: ['документы', 'аренда'],
    demo: true,
  },
  {
    id: 'act',
    icon: 'doc',
    cluster: 'docs',
    name: 'акт_приёмки.pdf',
    desc: 'Приёмка помещения, подписан 14 февраля',
    bytes: 820 * KB,
    date: '14 фев',
    pages: 3,
    tags: ['документы'],
    demo: true,
  },
  {
    id: 'estimate',
    icon: 'spreadsheetFin',
    cluster: 'fin',
    name: 'смета_офис.xlsx',
    desc: 'Смета ремонта и мебели, итог 1,24 млн ₽',
    bytes: Math.round(1.2 * MB),
    date: '16 фев',
    pages: 4,
    tags: ['финансы', 'аренда'],
    demo: true,
  },
  {
    id: 'budget',
    icon: 'sheet',
    cluster: 'fin',
    name: 'бюджет_2026.xlsx',
    desc: 'Личный бюджет на 2026 год, листы по месяцам',
    bytes: 860 * KB,
    date: '3 фев',
    pages: 12,
    tags: ['финансы', 'план'],
    demo: true,
  },
  {
    id: 'q1',
    icon: 'sheetSmall',
    cluster: 'fin',
    name: 'отчёт_квартал1.xlsx',
    desc: 'Расходы по офису за первый квартал',
    bytes: 540 * KB,
    date: '2 апр',
    pages: 5,
    tags: ['финансы'],
    demo: true,
  },
  {
    id: 'office-photo',
    icon: 'image',
    cluster: 'img',
    name: 'фото_офиса.jpg',
    desc: 'Съёмка помещения до ремонта, 12 февраля',
    bytes: Math.round(3.4 * MB),
    date: '12 фев',
    tags: ['аренда'],
    demo: true,
  },
  {
    id: 'build-error',
    icon: 'image',
    cluster: 'img',
    name: 'скрин_ошибки_сборки.png',
    desc: 'Скриншот ошибки сборки проекта «Сайт», строка 142',
    bytes: Math.round(1.1 * MB),
    date: 'вчера',
    tags: ['скриншот', 'баг'],
    demo: true,
  },
  {
    id: 'meeting-notes',
    icon: 'docDraft',
    cluster: 'proj',
    name: 'заметки_встречи.txt',
    desc: 'Обсуждение условий с арендодателем',
    bytes: 18 * KB,
    date: '11 фев',
    tags: ['аренда'],
    demo: true,
  },
  {
    id: 'pitch',
    icon: 'presentation',
    cluster: 'proj',
    name: 'презентация_стартап.pptx',
    desc: 'Питч-дек стартапа: 14 слайдов, для инвесторов',
    bytes: Math.round(14.7 * MB),
    date: '18 фев',
    pages: 14,
    tags: ['проект', 'питч'],
    demo: true,
  },
  {
    id: 'ideas',
    icon: 'docCheck',
    cluster: 'misc',
    name: 'заметки_идеи.md',
    desc: 'Черновик идей: демо-запись без прочитанного содержимого',
    bytes: 12 * KB,
    date: 'только что',
    tags: ['новое', 'продукт'],
    demo: true,
  },
  {
    id: 'demo-track',
    icon: 'music',
    cluster: 'music',
    name: 'демо_трек.mp3',
    desc: 'Черновик музыкальной идеи: гитара + бит, 3 минуты',
    bytes: Math.round(6.8 * MB),
    date: '20 фев',
    tags: ['музыка', 'черновик'],
    demo: true,
  },
]

/** Демо-стикеры первого запуска: приколоты к настоящим id демо-файлов. */
export function demoNotes(t0: number): Note[] {
  return [
    {
      id: 'n-key',
      title: 'Ключ от сейфа арендодателя',
      body: 'Код домофона 41К, ключ у охраны на первом этаже. Стереть сразу после переезда.',
      tags: ['аренда', 'секрет'],
      expiresAt: t0 + 2 * MIN + 45_000,
      lifeSpan: 6 * HOUR,
      locked: true,
      secret: null,
      pinnedTo: 'rent-2026',
      createdAt: t0 - 5 * HOUR,
      demo: true,
    },
    {
      id: 'n-pitch',
      title: 'Что переписать в питче',
      body: 'Слайд 7 — убрать три графика, оставить один. Слайд 11 — цифры за январь уже устарели, взять из бюджета.',
      tags: ['питч', 'правки'],
      expiresAt: null,
      lifeSpan: null,
      locked: false,
      secret: null,
      pinnedTo: 'pitch',
      createdAt: t0 - 6 * DAY,
      demo: true,
    },
    {
      id: 'n-idea',
      title: 'Идея на утро',
      body: 'Сделать так, чтобы ИИ сам предлагал приколоть стикер к файлу, если текст пересекается по смыслу.',
      tags: ['продукт', 'идея'],
      expiresAt: t0 + 18 * HOUR,
      lifeSpan: DAY,
      locked: false,
      secret: null,
      createdAt: t0 - 7 * HOUR,
      demo: true,
    },
    {
      id: 'n-money',
      title: 'Разговор с бухгалтером',
      body: 'Просил пересчитать налог по новой ставке, обещал прислать таблицу до пятницы. Проверить бюджет после.',
      tags: ['финансы'],
      expiresAt: t0 + 5 * DAY,
      lifeSpan: 7 * DAY,
      locked: true,
      secret: null,
      pinnedTo: 'budget',
      createdAt: t0 - 4 * DAY,
      demo: true,
    },
  ]
}

/**
 * Демо-разговор: лежит в рельсе как сохранённая сессия, а не как старт.
 * Числа трассировки берутся из сейфа на момент первого запуска, поэтому
 * «просканировано» совпадает со счётчиком файлов в навигации.
 */
export function demoSession(now: number, scanned: number): Session {
  const first = resolveAnswer(CHAT_ANSWERS[0], { scanned, has: () => true })
  const second = resolveAnswer(CHAT_ANSWERS[1], { scanned, has: () => true })
  return {
    id: 'seed-7f3a',
    title: 'Аренда офиса, февраль',
    createdAt: now - 1000 * 60 * 42,
    pinned: ['rent-2026'],
    demo: true,
    msgs: [
      {
        id: 'u1',
        role: 'user',
        time: '14:02',
        text: 'Найди договор аренды офиса, который я подписывал в феврале',
      },
      {
        id: 'a1',
        role: 'ai',
        time: '14:02',
        text: first.text,
        sources: first.sources,
        scanned: first.scanned,
        picked: first.picked,
        ms: 820,
        grounded: first.grounded,
        stages: buildStages(first.scanned, first.picked, first.sources.length),
      },
      {
        id: 'u2',
        role: 'user',
        time: '14:04',
        text: 'А что ещё с ним связано? Хочу понять всю картину по офису',
      },
      {
        id: 'a2',
        role: 'ai',
        time: '14:04',
        text: second.text,
        sources: second.sources,
        scanned: second.scanned,
        picked: second.picked,
        ms: 1140,
        grounded: second.grounded,
        stages: buildStages(second.scanned, second.picked, second.sources.length),
      },
    ],
  }
}
