export function extensionPackName(path: string): string {
  const encodedName = path.split('/').filter(Boolean).at(-1) ?? path
  try {
    return decodeURIComponent(encodedName)
  } catch {
    return encodedName
  }
}
