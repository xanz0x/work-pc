/**
 * Каталог ошибок ИИ-слоя. Наружу уходит только код и человеческая фраза:
 * ни имён переменных окружения, ни стека, ни дословного ответа провайдера.
 */

export type AiErrorCode =
  | 'ENGINE_NOT_CONFIGURED'
  | 'CLOUD_NOT_CONFIGURED'
  | 'UPSTREAM_BUSY'
  | 'UPSTREAM_ERROR'
  | 'CONTEXT_TOO_LONG'
  | 'RATE_LIMITED'
  | 'AUTH_REQUIRED'
  | 'NETWORK'
  | 'UNKNOWN'

export type AiErrorView = { code: AiErrorCode; title: string; hint: string; retry: boolean }

export const AI_ERRORS: Record<AiErrorCode, { title: string; hint: string; retry: boolean }> = {
  ENGINE_NOT_CONFIGURED: {
    title: 'Локальный движок не подключён',
    hint: 'Выбран локальный режим, а локальной модели на устройстве нет. Смените движок в настройках или дождитесь локального движка.',
    retry: false,
  },
  CLOUD_NOT_CONFIGURED: {
    title: 'Облачный движок не настроен',
    hint: 'Доступ к внешней модели не настроен на сервере. Обратитесь к владельцу сборки.',
    retry: false,
  },
  UPSTREAM_BUSY: {
    title: 'Модель занята',
    hint: 'Провайдер попросил подождать. Мы уже пробовали повторить — попробуйте ещё раз через минуту.',
    retry: true,
  },
  UPSTREAM_ERROR: {
    title: 'Модель не ответила',
    hint: 'Сбой на стороне провайдера. Подробности записаны в журнал сервера.',
    retry: true,
  },
  CONTEXT_TOO_LONG: {
    title: 'Слишком длинный контекст',
    hint: 'Разговор не помещается в окно модели. Начните новый диалог или снимите часть закреплённых файлов.',
    retry: false,
  },
  RATE_LIMITED: {
    title: 'Слишком часто',
    hint: 'Достигнут лимит запросов. Подождите немного и повторите.',
    retry: true,
  },
  AUTH_REQUIRED: {
    title: 'Нужен вход в приложение',
    hint: 'Сессия истекла. Войдите паролем приложения и повторите запрос.',
    retry: false,
  },
  NETWORK: {
    title: 'Нет связи с сервером',
    hint: 'Запрос не дошёл до приложения. Проверьте соединение и повторите.',
    retry: true,
  },
  UNKNOWN: {
    title: 'Не удалось получить ответ',
    hint: 'Причина неизвестна, подробности в журнале сервера. Попробуйте повторить.',
    retry: true,
  },
}

export function isAiErrorCode(v: unknown): v is AiErrorCode {
  return typeof v === 'string' && v in AI_ERRORS
}

export function describeAiError(code: unknown): AiErrorView {
  const c: AiErrorCode = isAiErrorCode(code) ? code : 'UNKNOWN'
  return { code: c, ...AI_ERRORS[c] }
}

/** Короткий идентификатор запроса: связывает UI и строку в логе сервера. */
export function requestId(): string {
  return Math.random().toString(36).slice(2, 10)
}
