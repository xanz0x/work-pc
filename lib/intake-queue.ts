/* Очередь приёма файлов: кнопка «Добавить файл» в меню отдаёт выбранные
   файлы библиотеке, а та спрашивает подпапку и принимает их тем же путём. */

let queued: File[] = []

export const QUEUE_EVENT = 'wsx:intake-queued'

export function queueIntake(files: File[]): void {
  queued = files
  window.dispatchEvent(new Event(QUEUE_EVENT))
}

export function takeIntake(): File[] {
  const out = queued
  queued = []
  return out
}
