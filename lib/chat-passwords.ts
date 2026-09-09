/** Generated values never enter messages, model requests or persistent storage. */
const values = new Map<string, { session: string; value: string }>()
export function keepChatPassword(session: string, value: string) {
  const ref = crypto.randomUUID()
  values.set(ref, { session, value })
  return ref
}
export function readChatPassword(ref: string, session?: string): string | null {
  const item = values.get(ref)
  return item && (session === undefined || item.session === session) ? item.value : null
}
export function clearChatPasswords() { values.clear() }
export function chatPasswordRefs(session: string) { return [...values].filter(([, item]) => item.session === session).map(([ref]) => ref) }