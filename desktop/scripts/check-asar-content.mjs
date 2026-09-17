// Проверка содержимого asar свежей сборки: новые блоки Tailscale/смены адреса.
import { createRequire } from 'node:module'
import path from 'node:path'
const require = createRequire(import.meta.url)
const desktop = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const a = require(path.join(desktop, 'node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar/lib/asar.js'))
const file = path.join(desktop, 'release', 'win-unpacked', 'resources', 'app.asar')
const js = a.extractFile(file, 'ui/setup.js').toString('utf8')
const html = a.extractFile(file, 'ui/setup.html').toString('utf8')
const main = a.extractFile(file, 'src/main.mjs').toString('utf8')
const preload = a.extractFile(file, 'src/preload.cjs').toString('utf8')
console.log('setup.js: tailscaleInstall=' + js.includes('api.tailscaleInstall') + ', updateHost=' + js.includes('api.updateHost') + ', confirmNotUsed=' + !js.includes('confirm('))
console.log('setup.html: ts-panel=' + html.includes('tailscale-panel') + ', host-address-settings=' + html.includes('host-address-settings'))
console.log('main.mjs: update-host=' + main.includes("'setup:update-host'") + ', ts-status=' + main.includes("'setup:tailscale-status'") + ', ts-install=' + main.includes("'setup:tailscale-install'") + ', renewCert=' + main.includes('renewCertificate'))
console.log('preload.cjs: updateHost=' + preload.includes('updateHost') + ', tsStatus=' + preload.includes('tailscaleStatus'))
