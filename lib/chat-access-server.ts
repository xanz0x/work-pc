import { getUser } from './users-server'
import { requireUser } from './request-context'
import { listSkills } from './ai-server'
import { CHAT_TOOLS, toolAccess } from './chat-tools'
import { mailEnabled } from './mail-crypto'
import { sonjjConfigured } from './temp-mail'

export async function chatCapabilities() {
  const user = await getUser(requireUser().uid)
  if (!user) throw new Error('Учётная запись не найдена')
  const skills = await listSkills()
  return {
    user,
    skills,
    tools: Object.keys(CHAT_TOOLS).map((name) => ({ name, label: CHAT_TOOLS[name].label, reason: toolAccess(name, user), enabled: skills.some((s) => s.tool === name && s.enabled) })),
    mail: user.features.mail ? { configured: mailEnabled(), gmailConfigured: mailEnabled() && sonjjConfigured(), note: 'Наличие настройки не подтверждает доступность сервиса или баланс.' } : null,
  }
}