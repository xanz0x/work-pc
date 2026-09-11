import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, type APIRequestContext } from '@playwright/test'

/**
 * Ящик временной почты с тестовым письмом (кнопка + текст + картинка).
 * Ключи не нужны: адрес выдаёт mail.tm, письмо доставляется прямым SMTP
 * (scripts/qa-send-rich-mail.py). Если ящик уже есть — используем его и
 * не удаляем (mine=false).
 */

export type Box = { id: string; kind: string; address: string; count: number }
export type Row = { mid: string; subject: string }

export const RICH_SUBJECT = 'Проверка меню'
const run = promisify(execFile)

export async function prepareRichMail(api: APIRequestContext): Promise<{ box: Box; row: Row; mine: boolean }> {
  const boxes = (await (await api.get('/ai-api/mail/temp')).json()) as { boxes: Box[] }
  let box = boxes.boxes.find((b) => b.kind === 'mailtm')
  let mine = false
  if (!box) {
    const r = await api.post('/ai-api/mail/temp', { data: { kind: 'mailtm' } })
    expect(r.ok(), await r.text()).toBeTruthy()
    box = ((await r.json()) as { box: Box }).box
    mine = true
  }

  const letters = async () => {
    const r = await api.get(`/ai-api/mail/temp/${box!.id}/inbox`)
    expect(r.ok(), await r.text()).toBeTruthy()
    return ((await r.json()) as { rows: Row[] }).rows
  }

  let row = (await letters()).find((r) => r.subject.includes(RICH_SUBJECT))
  if (!row) {
    await run('python3', ['scripts/qa-send-rich-mail.py', box.address], { cwd: '/app' })
    await expect(async () => {
      row = (await letters()).find((r) => r.subject.includes(RICH_SUBJECT))
      expect(row, 'письмо ещё не доставлено').toBeTruthy()
    }).toPass({ timeout: 90_000, intervals: [3_000] })
  }
  return { box, row: row!, mine }
}

export async function dropBox(api: APIRequestContext, box: Box, mine: boolean): Promise<void> {
  if (!mine) return
  const r = await api.delete(`/ai-api/mail/temp/${box.id}`)
  expect(r.ok(), await r.text()).toBeTruthy()
}
