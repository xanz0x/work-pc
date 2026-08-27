/**
 * Модель разговора спроектирована так, чтобы её можно было заменить на части
 * UIMessage из AI SDK без переделки интерфейса: текст отдельно, источники
 * отдельно, сноски в тексте — обычная разметка [1], [2].
 */

/** Один источник ответа: файл, страница, цитата, вес совпадения. */
export type ChatSource = {
  /** Номер сноски в тексте ответа. */
  n: number
  /** id файла из lib/data.ts */
  fileId: string
  /** Человеческая ссылка внутри файла: «стр. 1 из 18», «лист «Аренда»». */
  locator?: string
  quote: string
  /** Релевантность 0–100. Рисуется непрозрачностью, не новым цветом. */
  weight: number
}

/** Стадия поиска: показывается до текста, потом сворачивается в сводку. */
export type TraceStage = { label: string; ms: number }

export type UserMsg = {
  id: string
  role: 'user'
  time: string
  text: string
  /** Ветки правок запроса: 1/2 переключается в действиях сообщения. */
  variants?: string[]
}

export type AiMsg = {
  id: string
  role: 'ai'
  time: string
  text: string
  sources: ChatSource[]
  /** Сколько файлов просканировано / отобрано. */
  scanned: number
  picked: number
  /** Полное время «генерации» в мс — для сводки трассировки. */
  ms: number
  /** false — это вывод модели, а не находка в архиве. */
  grounded: boolean
  /** Ответ прерван пользователем. */
  stopped?: boolean
  stages: TraceStage[]
}

export type ChatMsg = UserMsg | AiMsg

export type Session = {
  id: string
  title: string
  createdAt: number
  msgs: ChatMsg[]
  /** Закреплённый пользователем контекст: id файлов из lib/data.ts */
  pinned: string[]
}

/** Заготовка ответа: то, что вернёт локальная модель на очередной запрос. */
export type Answer = {
  text: string
  sources: ChatSource[]
  scanned: number
  picked: number
  grounded: boolean
}

export function isAi(m: ChatMsg): m is AiMsg {
  return m.role === 'ai'
}
