import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { testI18n } from '@/utils/__tests__/testI18n'
import { useToast } from '@/components/ui/toast/toastStore'
import { useSettingStore } from '@/platform/settings/settingStore'
import { reportError } from '@/platform/telemetry/reportError'
import { useExtensionStore } from '@/stores/extensionStore'

import ExtensionPanel from './ExtensionPanel.vue'

vi.mock(import('@/platform/telemetry/reportError'))

function registerExtensions(...names: string[]) {
  const extensionStore = useExtensionStore()
  for (const name of names) extensionStore.registerExtension({ name })
}

function renderPanel() {
  return render(ExtensionPanel, { global: { plugins: [testI18n] } })
}

function pendingChangeFor(subject: string) {
  const row = screen
    .getAllByRole('listitem')
    .find((item) => item.textContent.includes(subject))
  return row?.textContent ?? ''
}

describe('ExtensionPanel', () => {
  afterEach(() => window.history.replaceState(null, '', '/'))

  it('preserves the selected filter when clicked again', async () => {
    const user = userEvent.setup()
    renderPanel()

    const coreFilter = screen.getByRole('button', { name: 'Core' })
    await user.click(coreFilter)
    await user.click(coreFilter)

    expect(coreFilter).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps registration order until the name column is sorted', async () => {
    const user = userEvent.setup()
    registerExtensions('Zebra', 'Alpha')
    renderPanel()

    const names = () =>
      screen
        .getAllByRole('switch', { name: /^(Alpha|Zebra)$/ })
        .map((toggle) => toggle.getAttribute('aria-label'))

    expect(
      screen.getByRole('columnheader', { name: 'Extension Name' })
    ).toHaveAttribute('aria-sort', 'none')
    expect(names()).toEqual(['Zebra', 'Alpha'])

    await user.click(screen.getByRole('button', { name: 'Extension Name' }))
    expect(names()).toEqual(['Alpha', 'Zebra'])

    await user.click(screen.getByRole('button', { name: 'Extension Name' }))
    expect(names()).toEqual(['Zebra', 'Alpha'])
  })

  it('shows select all as mixed while only some visible rows are selected', async () => {
    const user = userEvent.setup()
    registerExtensions('Alpha', 'Zebra')
    renderPanel()

    await user.click(screen.getByRole('checkbox', { name: 'Select Alpha' }))

    expect(
      screen.getByRole('checkbox', { name: 'Select All' })
    ).toBePartiallyChecked()
  })

  it('toggles selection from anywhere on the row, including cell padding, except its enable switch', async () => {
    const user = userEvent.setup()
    registerExtensions('Alpha')
    vi.spyOn(useSettingStore(), 'set').mockResolvedValue()
    renderPanel()
    const checkbox = screen.getByRole('checkbox', { name: 'Select Alpha' })
    const [checkboxCell, nameCell, switchCell] = within(
      screen.getByRole('row', { name: /Alpha Custom/ })
    ).getAllByRole('cell')

    await user.click(nameCell)
    expect(checkbox).toBeChecked()

    await user.click(checkboxCell)
    expect(checkbox).not.toBeChecked()

    await user.click(switchCell)
    expect(checkbox).toBeChecked()

    await user.click(checkbox)
    expect(checkbox).not.toBeChecked()

    await user.click(screen.getByRole('switch', { name: 'Alpha' }))
    expect(checkbox).not.toBeChecked()
  })

  it('replaces the selection with the visible rows on select all and clears it on unselect', async () => {
    const user = userEvent.setup()
    registerExtensions('Alpha', 'Zebra')
    const setSetting = vi.spyOn(useSettingStore(), 'set').mockResolvedValue()
    renderPanel()
    const search = screen.getByRole('combobox')
    const selectAll = () => screen.getByRole('checkbox', { name: 'Select All' })

    await user.click(screen.getByRole('checkbox', { name: 'Select Alpha' }))
    await user.type(search, 'Zebra')
    await user.click(selectAll())
    await user.clear(search)

    expect(
      screen.getByRole('checkbox', { name: 'Select Alpha' })
    ).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select Zebra' })).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'More Options' }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Disable Selected' })
    )
    expect(setSetting).toHaveBeenLastCalledWith('Comfy.Extension.Disabled', [
      'Zebra'
    ])

    await user.click(screen.getByRole('checkbox', { name: 'Select Alpha' }))
    await user.type(search, 'Zebra')
    await user.click(selectAll())
    await user.clear(search)

    expect(
      screen.getByRole('checkbox', { name: 'Select Alpha' })
    ).not.toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: 'Select Zebra' })
    ).not.toBeChecked()
  })

  it('toggles only the selected extensions and offers a reload while they differ', async () => {
    const user = userEvent.setup()
    registerExtensions('Alpha', 'Zebra')
    const setSetting = vi.spyOn(useSettingStore(), 'set').mockResolvedValue()
    const reload = vi.spyOn(window.location, 'reload').mockReturnValue()

    renderPanel()
    const moreOptions = screen.getByRole('button', { name: 'More Options' })
    expect(moreOptions).toHaveAttribute('aria-haspopup', 'menu')
    await user.click(screen.getByRole('checkbox', { name: 'Select Alpha' }))
    await user.click(moreOptions)
    await user.click(
      await screen.findByRole('menuitem', { name: 'Disable Selected' })
    )

    expect(screen.getByRole('switch', { name: 'Alpha' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Zebra' })).toBeChecked()
    expect(setSetting).toHaveBeenLastCalledWith('Comfy.Extension.Disabled', [
      'Alpha'
    ])
    await user.click(
      screen.getByRole('button', { name: 'Reload to apply changes' })
    )
    expect(reload).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'More Options' }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Enable Selected' })
    )

    expect(screen.getByRole('switch', { name: 'Alpha' })).toBeChecked()
    expect(setSetting).toHaveBeenLastCalledWith('Comfy.Extension.Disabled', [])
    expect(
      screen.queryByRole('button', { name: 'Reload to apply changes' })
    ).not.toBeInTheDocument()
  })

  it('disables a whole extension pack without dropping absent disabled packs', async () => {
    const user = userEvent.setup()
    const extensionStore = useExtensionStore()
    extensionStore.loadExtensionPackPaths(
      ['/extensions/agent-cushions/'],
      ['/extensions/missing/']
    )
    const setSetting = vi.spyOn(useSettingStore(), 'set').mockResolvedValue()

    renderPanel()
    await user.click(
      screen.getByRole('switch', { name: 'Extension pack agent-cushions' })
    )

    expect(setSetting).toHaveBeenLastCalledWith(
      'Comfy.Extension.DisabledPacks',
      ['/extensions/missing/', '/extensions/agent-cushions/']
    )
    expect(
      screen.getByRole('button', { name: 'Reload to apply changes' })
    ).toBeVisible()
    expect(pendingChangeFor('agent-cushions')).toContain('[-]')
  })

  it('marks a pending pack enable with [+]', async () => {
    const user = userEvent.setup()
    const extensionStore = useExtensionStore()
    const settingStore = useSettingStore()
    extensionStore.loadExtensionPackPaths(
      ['/extensions/agent-cushions/'],
      ['/extensions/agent-cushions/']
    )
    settingStore.$patch({
      settingValues: {
        'Comfy.Extension.DisabledPacks': ['/extensions/agent-cushions/']
      }
    })
    vi.spyOn(settingStore, 'set').mockResolvedValue()

    renderPanel()
    await user.click(
      screen.getByRole('switch', { name: 'Extension pack agent-cushions' })
    )

    expect(pendingChangeFor('agent-cushions')).toContain('[+]')
  })

  it('keeps pending pack state across panel remounts', async () => {
    const user = userEvent.setup()
    const extensionStore = useExtensionStore()
    const settingStore = useSettingStore()
    extensionStore.loadExtensionPackPaths(['/extensions/agent-cushions/'], [])
    vi.spyOn(settingStore, 'set').mockImplementation(async (key, value) => {
      settingStore.$patch({ settingValues: { [key]: value } })
    })

    const firstPanel = renderPanel()
    await user.click(
      screen.getByRole('switch', { name: 'Extension pack agent-cushions' })
    )
    firstPanel.unmount()
    renderPanel()

    expect(
      screen.getByRole('switch', { name: 'Extension pack agent-cushions' })
    ).not.toBeChecked()
    expect(pendingChangeFor('agent-cushions')).toContain('[-]')
  })

  it('keeps pack controls unavailable until the setting persists', async () => {
    const user = userEvent.setup()
    let resolveSetting = () => {}
    const pendingSetting = new Promise<void>((resolve) => {
      resolveSetting = resolve
    })
    useExtensionStore().loadExtensionPackPaths(['/extensions/a/'], [])
    vi.spyOn(useSettingStore(), 'set').mockReturnValue(pendingSetting)

    renderPanel()
    const packSwitch = screen.getByRole('switch', {
      name: 'Extension pack a'
    })
    await user.click(packSwitch)

    expect(packSwitch).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Reload to apply changes' })
    ).toBeDisabled()

    resolveSetting()
    await vi.waitFor(() => expect(packSwitch).toBeEnabled())
  })

  it('restores the pack and notifies when persistence fails', async () => {
    const user = userEvent.setup()
    const settingStore = useSettingStore()
    useExtensionStore().loadExtensionPackPaths(['/extensions/a/'], [])
    const failure = new Error('setting unavailable')
    const setSetting = vi.spyOn(settingStore, 'set').mockRejectedValue(failure)

    renderPanel()
    const packSwitch = screen.getByRole('switch', {
      name: 'Extension pack a'
    })
    await user.click(packSwitch)

    await vi.waitFor(() => expect(packSwitch).toBeChecked())
    expect(setSetting).toHaveBeenNthCalledWith(
      1,
      'Comfy.Extension.DisabledPacks',
      ['/extensions/a/']
    )
    expect(setSetting).toHaveBeenNthCalledWith(
      2,
      'Comfy.Extension.DisabledPacks',
      []
    )
    expect(reportError).toHaveBeenCalledWith(failure, {
      errorType: 'failure_writing_extension_pack_setting',
      surface: 'platform'
    })
    expect(useToast().toasts).toContainEqual(
      expect.objectContaining({
        kind: 'error',
        title: 'Error',
        description:
          'The extension pack change was not saved. Reload the page before trying again.'
      })
    )
  })

  it('decodes pack names for display and accessibility', async () => {
    const user = userEvent.setup()
    useExtensionStore().loadExtensionPackPaths(['/extensions/My%20Pack/'], [])
    vi.spyOn(useSettingStore(), 'set').mockResolvedValue()

    renderPanel()
    await user.click(
      screen.getByRole('switch', { name: 'Extension pack My Pack' })
    )

    expect(pendingChangeFor('My Pack')).toContain('[-]')
  })

  it('leaves safe mode before reloading pack changes', async () => {
    const user = userEvent.setup()
    useExtensionStore().loadExtensionPackPaths(['/extensions/a/'], [])
    vi.spyOn(useSettingStore(), 'set').mockResolvedValue()
    const reload = vi.spyOn(window.location, 'reload').mockReturnValue()
    const historyState = { back: '/workflows' }
    window.history.replaceState(historyState, '', '/?safe')

    renderPanel()
    await user.click(screen.getByRole('switch', { name: 'Extension pack a' }))
    await user.click(
      screen.getByRole('button', { name: 'Reload to apply changes' })
    )

    expect(window.location.search).toBe('')
    expect(window.history.state).toEqual(historyState)
    expect(reload).toHaveBeenCalledOnce()
  })
})
