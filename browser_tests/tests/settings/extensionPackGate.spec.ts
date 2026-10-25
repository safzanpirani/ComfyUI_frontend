import {
  comfyExpect as expect,
  comfyPageFixture as test
} from '@e2e/fixtures/ComfyPage'

test.use({
  initialSettings: {
    'Comfy.Extension.DisabledPacks': ['/extensions/agent-cushions/']
  }
})

// No `/api/settings` route mock: `initialSettings` already writes the disabled
// pack through the fixture's `set_settings` call, so the real settings response
// carries it. Mocking the GET would serve only this one key and drop every
// other fixture default, which is how a gate test starts failing on onboarding.
test.beforeEach(async ({ page }) => {
  await page.route('**/extensions', (route) =>
    route.fulfill({
      json: ['/extensions/agent-cushions/main.js']
    })
  )
  await page.route('**/extensions/agent-cushions/main.js*', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: "document.body.style.opacity = '0.2'"
    })
  )
})

test.describe(
  'Extension pack import gate',
  { tag: ['@settings', '@canvas'] },
  () => {
    test("does not apply a disabled pack's top-level visual side effects", async ({
      comfyPage,
      page
    }) => {
      await expect(comfyPage.canvas).toBeVisible()
      expect(
        await comfyPage.settings.getSetting('Comfy.Extension.DisabledPacks')
      ).toEqual(['/extensions/agent-cushions/'])
      await expect(page.locator('body')).toHaveCSS('opacity', '1')
    })
  }
)
