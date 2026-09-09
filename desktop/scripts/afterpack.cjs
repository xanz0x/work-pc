// electron-builder afterPack: the packer silently drops `node_modules` nested
// inside extraResources, which breaks the packaged standalone server
// (MODULE_NOT_FOUND: next). Copy the staged server node_modules ourselves and
// verify that the packaged server resolves its runtime strictly inside
// resources — no help from ancestor node_modules (repo/dev machine).
const path = require('node:path')
const { cpSync, existsSync } = require('node:fs')
const { createRequire } = require('node:module')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const resources = path.join(context.appOutDir, 'resources')
  const serverDest = path.join(resources, 'server')
  const staged = path.join(context.packager.projectDir, 'staging', 'server')
  const nmSrc = path.join(staged, 'node_modules')
  const nmDest = path.join(serverDest, 'node_modules')
  if (!existsSync(path.join(nmDest, 'next')) && existsSync(path.join(nmSrc, 'next'))) {
    cpSync(nmSrc, nmDest, { recursive: true, dereference: true })
  }
  const req = createRequire(path.join(serverDest, 'server.js'))
  for (const name of ['next', 'react', 'react-dom', 'nodemailer', 'mailparser', 'imapflow']) {
    const resolved = req.resolve(name)
    if (!resolved.startsWith(serverDest)) {
      throw new Error(`Packaged server resolves '${name}' outside resources: ${resolved}. The installer would fail on a clean machine.`)
    }
  }
}
