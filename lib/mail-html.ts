/* ПОЧТА · санитайзер HTML письма. Первая линия защиты — сервер вырезает скрипты и
   активные атрибуты; вторая — клиент рендерит результат в iframe с sandbox и CSP. */

const DROP_WITH_BODY = /<(script|iframe|object|embed|applet|frame|frameset|noscript|template|svg|math|audio|video|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
const DROP_TAG = /<\/?(script|iframe|object|embed|applet|frame|frameset|noscript|template|svg|math|audio|video|form|input|button|textarea|select|option|link|meta|base|body|html|head)\b[^>]*>/gi
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'background', 'poster', 'xlink:href', 'srcset', 'ping', 'srcdoc', 'data', 'codebase'])
const BAD_URL = /^\s*(javascript|vbscript|livescript|mocha|data(?!:image\/(png|jpe?g|gif|webp|bmp)))\s*:/i
const ATTR_RE = /([^\s=>/"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g
const TAG_RE = /<([a-zA-Z][\w:-]*)((?:\s+[^\s=>/"']+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g

const unquote = (v: string) => (v.startsWith('"') || v.startsWith("'") ? v.slice(1, -1) : v)

const normUrl = (v: string) =>
  v
    .replace(/&#0*58;|&#x0*3a;|&colon;/gi, ':')
    .replace(/&tab;|&newline;/gi, '')
    .replace(/[\u0000-\u0020\u00a0]/g, '')

function cleanAttrs(attrs: string): string {
  const out: string[] = []
  for (const m of attrs.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase()
    const raw = m[2]
    if (name.startsWith('on') || name === 'srcdoc' || name === 'ping' || name === 'formaction') continue
    if (raw === undefined) {
      out.push(name)
      continue
    }
    const val = unquote(raw)
    if (URL_ATTRS.has(name) && BAD_URL.test(normUrl(val))) continue
    if (name === 'style' && /expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(val)) continue
    out.push(`${name}="${val.replace(/"/g, '&quot;')}"`)
  }
  return out.length ? ` ${out.join(' ')}` : ''
}

/** Вырезает скрипты, формы, фреймы, on*-обработчики и опасные URL. Разметку и стили оставляет. */
export function sanitizeMailHtml(html: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
  s = s.replace(DROP_WITH_BODY, '')
  s = s.replace(DROP_TAG, '')
  s = s.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_m, css: string) => `<style>${css.replace(/@import[^;]*;?/gi, '').replace(/expression\s*\([^)]*\)/gi, '')}</style>`)
  s = s.replace(TAG_RE, (_m, tag: string, attrs: string, slash: string) => `<${tag.toLowerCase()}${cleanAttrs(attrs)}${slash ? ' /' : ''}>`)
  s = s.replace(/<\/([a-zA-Z][\w:-]*)\s*>/g, (_m, tag: string) => `</${tag.toLowerCase()}>`)
  return s.trim()
}

/** Экранирование текста письма перед показом как HTML. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
