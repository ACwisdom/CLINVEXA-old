import path from 'node:path'

interface RendererIndexCandidatesOptions {
  appRoot: string
  webDist: string
  isPackaged: boolean
  fileExists: (candidate: string) => boolean
}

/**
 * Return the bounded renderer entry ladder used by the desktop shell.
 *
 * Packaged builds deliberately prefer the real file under
 * `app.asar.unpacked/dist`. Loading the duplicate entry through the virtual
 * app.asar filesystem can intermittently fail on Windows while antivirus or
 * another process is inspecting the archive. Development keeps the app-root
 * entry first because that is the normal Vite/esbuild output.
 */
export function rendererIndexCandidates({
  appRoot,
  webDist,
  isPackaged,
  fileExists
}: RendererIndexCandidatesOptions): string[] {
  const appRootIndex = path.join(appRoot, 'dist', 'index.html')
  const webDistIndex = path.join(webDist, 'index.html')
  const ordered = isPackaged ? [webDistIndex, appRootIndex] : [appRootIndex, webDistIndex]
  const unique = [...new Set(ordered)]
  const existing = unique.filter(fileExists)

  return existing.length > 0 ? existing : unique
}

interface LoadUrlCandidatesOptions {
  urls: string[]
  load: (url: string) => Promise<unknown>
  onFailure?: (url: string, error: unknown, attempt: number) => void
}

/** Load a finite URL ladder once per candidate and never spin indefinitely. */
export async function loadUrlCandidates({ urls, load, onFailure }: LoadUrlCandidatesOptions): Promise<string> {
  let lastError: unknown = new Error('No renderer URL candidates were provided')

  for (const [index, url] of urls.entries()) {
    try {
      await load(url)
      return url
    } catch (error) {
      lastError = error
      onFailure?.(url, error, index + 1)
    }
  }

  throw lastError
}
