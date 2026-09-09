/* Один Next.js-процесс: очередь общая для route-бандлов, ошибкой её не отравляем. */
const state = globalThis as typeof globalThis & { wsxCloudWrites?: Promise<unknown> }

export function cloudWrite<T>(work: () => Promise<T>): Promise<T> {
  const next = (state.wsxCloudWrites ?? Promise.resolve()).then(work, work)
  state.wsxCloudWrites = next.catch(() => undefined)
  return next
}