import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFile(path.resolve(process.cwd(), relative), 'utf8')
const excerptsPath = path.resolve(
  process.cwd(),
  'tests/fixtures/flask-template-source-excerpts-20261118.json',
)

type Excerpts = {
  templates: Record<string, { contains_maxlength?: boolean }>
}
const readExcerpts = async (): Promise<Excerpts> =>
  JSON.parse(await readFile(excerptsPath, 'utf8')) as Excerpts

describe('account form attribute parity (2026-11-22 audit)', () => {
  it('Flask auth forms impose no maxlength caps', async () => {
    const excerpts = await readExcerpts()
    for (const template of [
      'register.html',
      'login.html',
      'resend_verification.html',
      'forgot_password.html',
      'reset_password.html',
    ]) {
      expect(excerpts.templates[template]?.contains_maxlength, template).toBe(false)
    }
  })

  it('Nuxt register/login/resend inputs no longer impose client-only caps', async () => {
    for (const file of [
      'app/pages/register.vue',
      'app/pages/login.vue',
      'app/pages/resend-verification.vue',
    ]) {
      expect(await read(file), file).not.toContain('maxlength=')
    }
  })

  it('keeps Flask minlength and autocomplete attributes', async () => {
    const register = await read('app/pages/register.vue')
    expect(register).toContain('name="username" autocomplete="username" minlength="3" required')
    expect(register).toContain('autocomplete="new-password" minlength="8" required')
    const login = await read('app/pages/login.vue')
    expect(login).toContain('autocomplete="email"')
    expect(login).toContain('autocomplete="current-password"')
  })

  it('matches Flask name attributes on forgot/reset password inputs', async () => {
    const forgot = await read('app/pages/forgot-password.vue')
    expect(forgot).toContain('id="email" v-model="email" type="email" name="email"')
    const reset = await read('app/pages/reset-password/[token].vue')
    expect(reset).toContain('id="password" v-model="password" type="password" name="password"')
    expect(reset).toContain('id="confirm_password" v-model="confirm" type="password" name="confirm_password"')
  })

  it('always renders the login form for a signed-in visitor, like Flask', async () => {
    const login = await read('app/pages/login.vue')
    expect(login).not.toContain('const sessionUser = await auth.refresh(true)')
    expect(login).not.toContain("navigateTo('/account')\n      return")
    // The redirect after a successful submission is still required.
    expect(login).toContain("navigateTo('/account')")
  })

  it('lets the API report Flask validation order on registration', async () => {
    const register = await read('app/pages/register.vue')
    expect(register).not.toContain("message.value = 'Passwords do not match.'")
    expect(register).toContain('Flask validates username, then password length, then confirmation')
  })
})
