import https from 'node:https'
import http from 'node:http'

export async function startGateway(env, identity) {
  const server = https.createServer({ ...identity, minVersion: 'TLSv1.2', requestTimeout: 300000, headersTimeout: 20000 }, (req, res) => {
    if (req.url === '/__workspacex/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ protocol: 'workspacex-desktop-v1' }))
      return
    }
    // A web page on another origin may not post to the local private server.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin && req.headers.origin !== `https://${req.headers.host}`) {
      res.writeHead(403); res.end('Origin denied'); return
    }
    const headers = { ...req.headers }
    for (const name of Object.keys(headers)) {
      if (name.startsWith('x-forwarded-') || name.startsWith('x-user-') || ['forwarded', 'x-session-id', 'x-request-id'].includes(name)) delete headers[name]
    }
    headers['x-forwarded-for'] = req.socket.remoteAddress
    headers['x-forwarded-proto'] = 'https'
    const upstream = http.request({ host: env.WSX_LOOPBACK, port: Number(env.WSX_NEXT_PORT), path: req.url, method: req.method, headers, timeout: 300000 }, (response) => {
      res.writeHead(response.statusCode, { ...response.headers, 'X-Content-Type-Options': 'nosniff' })
      response.pipe(res)
      response.on('error', () => res.destroy())
    })
    upstream.on('error', () => {
      if (!res.headersSent) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Главный ПК запускает приложение. Повторите через несколько секунд.') }
      else res.destroy()
    })
    upstream.on('timeout', () => upstream.destroy())
    req.on('aborted', () => upstream.destroy())
    res.on('close', () => { if (!res.writableEnded) upstream.destroy() })
    req.pipe(upstream)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(Number(env.WSX_HTTPS_PORT), env.WSX_LISTEN_HOST, resolve)
  })
  return server
}