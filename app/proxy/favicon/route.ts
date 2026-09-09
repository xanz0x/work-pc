/* Прокси иконок сайтов: браузер ходит только в свой origin,
   наружу (Google S2) уходит ровно домен — как и было по контракту приватности. */

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const domain = new URL(req.url).searchParams.get('domain') ?? ''
  if (!/^[a-z0-9][a-z0-9.-]{0,250}$/i.test(domain)) return new Response('bad domain', { status: 400 })
  try {
    const res = await fetch(
      `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`,
      { cache: 'no-store' },
    )
    if (!res.ok) return new Response('upstream', { status: 502 })
    const buf = await res.arrayBuffer()
    return new Response(buf, {
      headers: {
        'content-type': res.headers.get('content-type') ?? 'image/png',
        'cache-control': 'public, max-age=86400',
      },
    })
  } catch {
    return new Response('offline', { status: 502 })
  }
}
