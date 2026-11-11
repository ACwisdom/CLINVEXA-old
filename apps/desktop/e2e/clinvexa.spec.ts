import { expect, test } from './test'

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'

let fixture: MockBackendFixture | null = null

test.setTimeout(180_000)

test.beforeAll(async () => {
  fixture = await setupMockBackend()
  await waitForAppReady(fixture, 120_000)
})

test.afterAll(async () => {
  await fixture?.cleanup()
  fixture = null
})

test('runs the CLINVEXA desktop, Agent, monitoring, Skill, and RPA surfaces', async () => {
  const page = fixture!.page

  await page.getByRole('button', { name: '打开 CLINVEXA' }).click()
  await expect(page.getByRole('complementary', { name: 'CLINVEXA 侧边栏' })).toBeVisible()

  await page.getByRole('button', { name: '暂停屏幕监听' }).click()
  await expect(page.getByRole('button', { name: '恢复屏幕监听' })).toBeVisible()
  await page.getByRole('button', { name: '恢复屏幕监听' }).click()

  await page.getByLabel('任务内容').fill('生成合成病历草稿 SYN-E2E-001')
  await page.getByRole('button', { name: '发送任务' }).click()
  await expect(page.getByText('生成合成病历草稿 SYN-E2E-001')).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: '打开完整工作台' }).click()
  await expect(page.getByRole('main', { name: 'CLINVEXA 工作台' })).toBeVisible()

  await page.getByRole('button', { name: '打开 Skill 广场' }).click()
  await expect(page.getByRole('main', { name: 'CLINVEXA Skill 广场' })).toBeVisible()

  await page.getByRole('button', { name: '打开 HIS RPA' }).click()
  await expect(page.getByRole('main', { name: 'CLINVEXA HIS RPA' })).toBeVisible()
  await expect(page.getByText('自动填写草稿，正式提交前必须医生确认')).toBeVisible()
})
