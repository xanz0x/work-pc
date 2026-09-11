/* ============================================================
   ПОЧТА · КАРТИНКИ ПИСЬМА
   Тело письма живёт в песочнице iframe без allow-same-origin:
   у неё opaque origin, поэтому запросы картинок уходят «на чужой
   сайт» — cookie сессии к ним не прикладывается, и серверный
   прокси /ai-api/mail/img отвечал бы отказом. Поэтому картинки
   качает сама страница (её cookie на месте) и подставляет их в
   письмо как data:-URI.
   ============================================================ */

const SRC_RE = /(\ssrc\s*=\s*)(["'])(https?:\/\/[^"']+)\2/gi

/** Есть ли в письме внешние картинки. */
export const hasRemoteImages = (html: string): boolean => /\ssrc\s*=\s*["']https?:/i.test(html)

const MAX_IMAGE_BYTES = 4 * 1024 * 1024
/* Суммарный бюджет: srcDoc письма не должен раздуваться на десятки МБ. */
const MAX_TOTAL_BYTES = 12 * 1024 * 1024

async function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(blob)
  })
}

/**
 * Заменить адреса внешних картинок на data:-URI, скачав их через прокси.
 * Что не скачалось — остаётся прежним адресом: письмо всё равно откроется.
 */
export async function inlineRemoteImages(html: string): Promise<string> {
  const urls = Array.from(new Set(Array.from(html.matchAll(SRC_RE), (m) => m[3])))
  if (urls.length === 0) return html
  const done = new Map<string, string>()
  let total = 0
  await Promise.all(
    urls.map(async (url) => {
      try {
        const r = await fetch(`/ai-api/mail/img?url=${encodeURIComponent(url)}`)
        if (!r.ok) return
        const blob = await r.blob()
        if (blob.size === 0 || blob.size > MAX_IMAGE_BYTES) return
        if (total + blob.size > MAX_TOTAL_BYTES) return
        total += blob.size
        done.set(url, await toDataUrl(blob))
      } catch {
        /* картинка не открылась — письмо важнее картинки */
      }
    }),
  )
  if (done.size === 0) return html
  /* Исходный адрес остаётся в data-wsx-src: контекстное меню письма должно
     открывать и копировать настоящую ссылку на картинку, а не data:-URI. */
  return html.replace(SRC_RE, (whole, pre: string, q: string, url: string) => {
    const data = done.get(url)
    return data ? `${pre}${q}${data}${q} data-wsx-src="${url.replace(/"/g, '&quot;')}"` : whole
  })
}
