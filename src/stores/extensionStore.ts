import { defineStore } from 'pinia'
import { computed, markRaw, ref } from 'vue'

import { useSettingStore } from '@/platform/settings/settingStore'
import { reportError } from '@/platform/telemetry/reportError'
import type { ComfyExtension } from '@/types/comfy'
import { getErrorMessage } from '@/utils/errorUtil'

/**
 * These extensions are always active, even if they are disabled in the setting.
 */
const ALWAYS_ENABLED_EXTENSIONS: readonly string[] = []

const ALWAYS_DISABLED_EXTENSIONS: readonly string[] = [
  // pysssss.Locking is replaced by pin/unpin in ComfyUI core.
  // https://github.com/Comfy-Org/litegraph.js/pull/117
  'pysssss.Locking',
  // pysssss.SnapToGrid is replaced by Comfy.Graph.AlwaysSnapToGrid in ComfyUI core.
  // pysssss.SnapToGrid tries to write global app.shiftDown state, which is no longer
  // allowed since v1.3.12.
  // https://github.com/Comfy-Org/ComfyUI_frontend/issues/1176
  'pysssss.SnapToGrid',
  // Favicon status is implemented in ComfyUI core in v1.20.
  // https://github.com/Comfy-Org/ComfyUI_frontend/pull/3880
  'pysssss.FaviconStatus',
  'KJNodes.browserstatus'
]

export const useExtensionStore = defineStore('extension', () => {
  // For legacy reasons, the name uniquely identifies an extension
  const extensionByName = ref<Record<string, ComfyExtension>>({})
  const extensions = computed(() => Object.values(extensionByName.value))
  // Not using computed because disable extension requires reloading of the page.
  // Dynamically update this list won't affect extensions that are already loaded.
  const disabledExtensionNames = ref<Set<string>>(new Set())
  const extensionPackPaths = ref<string[]>([])
  const disabledExtensionPackPaths = ref<Set<string>>(new Set())
  const isSavingExtensionPacks = ref(false)

  // Disabled extension names that are currently not in the extension list.
  // If a node pack is disabled in the backend, we shouldn't remove the configuration
  // of the frontend extension disable list, in case the node pack is re-enabled.
  const inactiveDisabledExtensionNames = computed(() => {
    return Array.from(disabledExtensionNames.value).filter(
      (name) => !(name in extensionByName.value)
    )
  })
  const isExtensionInstalled = (name: string) => name in extensionByName.value

  const isExtensionEnabled = (name: string) =>
    !disabledExtensionNames.value.has(name)
  const enabledExtensions = computed(() => {
    return extensions.value.filter((ext) => isExtensionEnabled(ext.name))
  })

  function isExtensionReadOnly(name: string) {
    return (
      ALWAYS_DISABLED_EXTENSIONS.includes(name) ||
      ALWAYS_ENABLED_EXTENSIONS.includes(name)
    )
  }

  function registerExtension(extension: ComfyExtension) {
    if (!extension.name) {
      throw new Error("Extensions must have a 'name' property.")
    }

    if (extension.name in extensionByName.value) {
      throw new Error(`Extension named '${extension.name}' already registered.`)
    }

    if (disabledExtensionNames.value.has(extension.name)) {
      console.warn(`Extension ${extension.name} is disabled.`)
    }

    extensionByName.value[extension.name] = markRaw(extension)
  }

  function unregisterExtension(name: string) {
    delete extensionByName.value[name]
  }

  function loadDisabledExtensionNames(names: string[]) {
    disabledExtensionNames.value = new Set(names)
    for (const name of ALWAYS_DISABLED_EXTENSIONS) {
      disabledExtensionNames.value.add(name)
    }
    for (const name of ALWAYS_ENABLED_EXTENSIONS) {
      disabledExtensionNames.value.delete(name)
    }
  }

  function loadExtensionPackPaths(paths: string[], disabledPaths: string[]) {
    extensionPackPaths.value = [...new Set(paths)]
    disabledExtensionPackPaths.value = new Set(disabledPaths)
  }

  const isExtensionPackEnabled = (path: string) =>
    !disabledExtensionPackPaths.value.has(path)

  function getCurrentDisabledExtensionPackPaths(): string[] {
    const storedPaths = useSettingStore().get('Comfy.Extension.DisabledPacks')
    return Array.isArray(storedPaths)
      ? storedPaths
      : Array.from(disabledExtensionPackPaths.value)
  }

  async function writeDisabledExtensionPackPaths(
    paths: string[]
  ): Promise<unknown | undefined> {
    try {
      const result = await useSettingStore().setWithResult(
        'Comfy.Extension.DisabledPacks',
        paths
      )
      return result?.ok === false ? result.error : undefined
    } catch (error) {
      return error
    }
  }

  function reportExtensionPackWriteFailure(
    cause: unknown,
    rollbackCause: unknown
  ) {
    reportError(cause, {
      errorType: 'failure_writing_extension_pack_setting',
      surface: 'platform',
      tags: { rollback_failed: rollbackCause !== undefined },
      context:
        rollbackCause === undefined
          ? undefined
          : { rollback_error: getErrorMessage(rollbackCause) }
    })
  }

  async function setExtensionPackEnabled(
    path: string,
    enabled: boolean
  ): Promise<boolean | undefined> {
    if (isSavingExtensionPacks.value) return

    const previousDisabledPaths = getCurrentDisabledExtensionPackPaths()
    const nextDisabledPaths = enabled
      ? previousDisabledPaths.filter((disabledPath) => disabledPath !== path)
      : [...new Set([...previousDisabledPaths, path])]
    isSavingExtensionPacks.value = true

    try {
      const cause = await writeDisabledExtensionPackPaths(nextDisabledPaths)
      if (cause === undefined) return true

      const rollbackCause = await writeDisabledExtensionPackPaths(
        previousDisabledPaths
      )
      reportExtensionPackWriteFailure(cause, rollbackCause)
      return false
    } finally {
      isSavingExtensionPacks.value = false
    }
  }

  /**
   * Core extensions are extensions that are defined in the core package.
   * See /extensions/core/index.ts for the list.
   */
  const coreExtensionNames = ref<string[]>([])
  function captureCoreExtensions() {
    coreExtensionNames.value = extensions.value.map((ext) => ext.name)
  }

  function isCoreExtension(name: string) {
    return coreExtensionNames.value.includes(name)
  }

  const hasThirdPartyExtensions = computed(() => {
    return extensions.value.some((ext) => !isCoreExtension(ext.name))
  })

  return {
    extensions,
    enabledExtensions,
    extensionPackPaths,
    isSavingExtensionPacks,
    inactiveDisabledExtensionNames,
    isExtensionInstalled,
    isExtensionEnabled,
    isExtensionReadOnly,
    registerExtension,
    unregisterExtension,
    loadDisabledExtensionNames,
    loadExtensionPackPaths,
    isExtensionPackEnabled,
    getCurrentDisabledExtensionPackPaths,
    setExtensionPackEnabled,
    captureCoreExtensions,
    isCoreExtension,
    hasThirdPartyExtensions
  }
})
