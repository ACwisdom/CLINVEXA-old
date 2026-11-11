interface RuntimeSyncRequiredOptions {
  isPackaged: boolean
  sameRoot: boolean
  sourceComplete: boolean
  activeComplete: boolean
  expectedFingerprint: string
  currentFingerprint: string | null
}

/** Decide whether the packaged runtime must be overlaid into the active runtime. */
export function runtimeSyncRequired({
  isPackaged,
  sameRoot,
  sourceComplete,
  activeComplete,
  expectedFingerprint,
  currentFingerprint
}: RuntimeSyncRequiredOptions): boolean {
  if (!isPackaged || sameRoot || !sourceComplete) {
    return false
  }

  return !activeComplete || currentFingerprint !== expectedFingerprint
}
