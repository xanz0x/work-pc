import type { Answer, Session, TraceStage } from '@/components/chat/types'

/** Подсказки пустого состояния: привязаны к реальным кластерам сейфа. */
export const CHAT_SUGGESTIONS = [
  'Где смета на офис?',
  'Придумай и сохрани пароль для GitHub в сейф',
  'Вытяни из Notion план запуска',
]

/** Стадии поиска. Числа зависят от того, сколько файлов реально отобрано. */
export function buildStages(scanned: number, picked: number, cited: number): TraceStage[] {
  return [
    { label: 'индексирую запрос', ms: 90 },
    { label: `сканирую ${scanned} файлов`, ms: 260 },
    { label: `отобрано ${picked}`, ms: 180 },
    { label: `читаю ${cited}`, ms: 210 },
    { label: 'формулирую', ms: 120 },
  ]
}

/**
 * Заготовленные ответы локальной модели. Порядок сохранён: сначала ответ с
 * одним точным источником, затем кластер, затем честное «совпадения нет».
 */
export const CHAT_ANSWERS: Answer[] = [
  {
    text:
      'Нашёл один точный документ в кластере «Документы» — совпадение по смыслу, а не по названию файла [1]. Правки к нему согласованы отдельным протоколом [2].',
    scanned: 0,
    picked: 9,
    grounded: true,
    sources: [
      {
        n: 1,
        fileId: 'rent-2026',
        locator: 'стр. 1 из 18',
        quote:
          'Арендодатель передаёт Арендатору офисное помещение площадью 84 м² на срок 12 месяцев с 12 февраля 2026 года.',
        weight: 98,
      },
      {
        n: 2,
        fileId: 'protocol',
        locator: 'стр. 2 из 6',
        quote:
          'Стороны согласовали изменение пункта 4.2: индексация ставки не чаще одного раза в год.',
        weight: 91,
      },
    ],
  },
  {
    text:
      'Собрал смысловой кластер вокруг офиса: расходы посчитаны в смете [1], состояние помещения зафиксировано съёмкой до ремонта [2], ежемесячный платёж лежит в бюджете [3]. Остальные файлы кластера видны на карте памяти.',
    scanned: 0,
    picked: 7,
    grounded: true,
    sources: [
      {
        n: 1,
        fileId: 'estimate',
        locator: 'лист «Итого»',
        quote: 'Ремонт и мебель: 1 240 000 ₽, из них мебель — 415 000 ₽.',
        weight: 87,
      },
      {
        n: 2,
        fileId: 'office-photo',
        locator: 'снимок 12 фев',
        quote: 'Помещение до ремонта: открытая планировка, 84 м², без мебели.',
        weight: 81,
      },
      {
        n: 3,
        fileId: 'budget',
        locator: 'лист «Аренда»',
        quote: 'Ежемесячный платёж 96 000 ₽, депозит 192 000 ₽ внесён 12 февраля.',
        weight: 74,
      },
    ],
  },
  {
    text:
      'Разобрал запрос на три смысловых признака и нашёл подтверждение в отчёте за квартал [1] и в акте приёмки [2]. Ничего не уходило в сеть: обе цитаты прочитаны с диска.',
    scanned: 0,
    picked: 5,
    grounded: true,
    sources: [
      {
        n: 1,
        fileId: 'q1',
        locator: 'лист «Офис»',
        quote: 'Расходы по офису за I квартал: 288 000 ₽ аренды и 1 240 000 ₽ обустройства.',
        weight: 84,
      },
      {
        n: 2,
        fileId: 'act',
        locator: 'стр. 1 из 3',
        quote: 'Помещение принято 14 февраля 2026 года без замечаний по составу передаваемого.',
        weight: 79,
      },
    ],
  },
  {
    text:
      'Точного совпадения в архиве нет. Это вывод модели по смежным файлам, а не цитата: судя по черновику заметок, условия обсуждались до подписания, но итоговая формулировка нигде не зафиксирована.',
    scanned: 0,
    picked: 1,
    grounded: false,
    sources: [],
  },
]

/** Запрос считается общим, если в нём нет ни одного различающего признака. */
export function isBroad(query: string): boolean {
  const words = query.trim().split(/\s+/).filter((w) => w.length > 2)
  return words.length < 2 && query.trim().length < 18
}

/* ============================================================
   ОТВЕТ ПРОТИВ ЖИВОГО СЕЙФА
   Заготовки выше — только шаблоны. Числа «просканировано» и состав
   источников берутся из настоящего состояния сейфа: если файл удалили
   или сейф стёрли, ответ не может сослаться на то, чего больше нет.
   ============================================================ */

export type AnswerCtx = {
  /** Сколько файлов реально лежит в сейфе прямо сейчас. */
  scanned: number
  /** Есть ли такой файл в сейфе. */
  has: (fileId: string) => boolean
}

/** Сейф пуст — сослаться не на что, и модель говорит это прямо. */
function emptyAnswer(): Answer {
  return {
    text:
      'В сейфе нет ни одного файла, поэтому искать не в чем. Добавьте документы через «Добавить файл» — после индексации я смогу отвечать цитатами из них.',
    scanned: 0,
    picked: 0,
    grounded: false,
    sources: [],
  }
}

/** Источники были, но файлы удалены из сейфа: ответ теряет право на цитату. */
function lostAnswer(scanned: number): Answer {
  return {
    text:
      'Файлы, на которые опирался этот ответ, больше не лежат в сейфе. Цитировать нечего: это вывод модели по остаткам индекса, а не находка в архиве.',
    scanned,
    picked: 0,
    grounded: false,
    sources: [],
  }
}

/** Слишком общий запрос: честно показываем, почему выборка бессмысленна. */
function broadAnswer(scanned: number): Answer {
  const wide = Math.max(2, Math.round(scanned * 0.59))
  return {
    text: `Запрос слишком общий: под него подходит ${wide} файлов из ${scanned}, и любая цитата будет случайной. Уточните период, тип документа или сумму — например «смета по офису за февраль».`,
    scanned,
    picked: wide,
    grounded: false,
    sources: [],
  }
}

/**
 * Приводит шаблон к состоянию сейфа: выкидывает источники на исчезнувшие
 * файлы, перенумеровывает сноски в тексте и пересчитывает числа трассировки.
 */
export function resolveAnswer(template: Answer, ctx: AnswerCtx): Answer {
  if (ctx.scanned === 0) return emptyAnswer()

  const kept = template.sources.filter((s) => ctx.has(s.fileId))
  if (template.sources.length > 0 && kept.length === 0) return lostAnswer(ctx.scanned)

  const renumber = new Map(kept.map((s, i) => [s.n, i + 1]))
  const text = template.text.replace(/\s*\[(\d+)\]/g, (_full, d: string) => {
    const next = renumber.get(Number(d))
    return next ? ` [${next}]` : ''
  })

  return {
    text,
    sources: kept.map((s) => ({ ...s, n: renumber.get(s.n) as number })),
    scanned: ctx.scanned,
    picked: Math.max(kept.length, Math.min(template.picked, ctx.scanned)),
    grounded: kept.length > 0 && template.grounded,
  }
}

/** Единственная точка выбора ответа: экран разговора зовёт только её. */
export function answerFor(query: string, cursor: number, ctx: AnswerCtx): Answer {
  if (ctx.scanned === 0) return emptyAnswer()
  if (isBroad(query)) return broadAnswer(ctx.scanned)
  return resolveAnswer(CHAT_ANSWERS[cursor % CHAT_ANSWERS.length], ctx)
}

/* UX-5: демо-разговор переехал в lib/demo-seed.ts (вне основного бандла). */
