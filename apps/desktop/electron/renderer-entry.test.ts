import assert from 'node:assert/strict'
import path from 'node:path'

import { test } from 'vitest'

import { loadUrlCandidates, rendererIndexCandidates } from './renderer-entry'

test('packaged builds prefer the unpacked renderer and retain the asar entry as fallback', () => {
  const candidates = rendererIndexCandidates({
    appRoot: 'C:\\CLINVEXA\\resources\\app.asar',
    webDist: 'C:\\CLINVEXA\\resources\\app.asar.unpacked\\dist',
    isPackaged: true,
    fileExists: () => true
  })

  assert.match(candidates[0], /app\.asar\.unpacked[\\/]dist[\\/]index\.html$/)
  assert.match(candidates[1], /app\.asar[\\/]dist[\\/]index\.html$/)
})

test('development builds keep the app-root renderer first', () => {
  const appRoot = path.resolve('repo', 'apps', 'desktop')

  const candidates = rendererIndexCandidates({
    appRoot,
    webDist: path.join(appRoot, 'dist'),
    isPackaged: false,
    fileExists: () => true
  })

  assert.equal(candidates.length, 1)
  assert.match(candidates[0], /apps[\\/]desktop[\\/]dist[\\/]index\.html$/)
})

test('renderer loading retries the next candidate once after a failure', async () => {
  const attempts: string[] = []
  const failures: string[] = []

  const selected = await loadUrlCandidates({
    urls: ['file:///unpacked/index.html', 'file:///app.asar/dist/index.html'],
    load: async url => {
      attempts.push(url)

      if (url.includes('unpacked')) {
        throw new Error('ERR_FAILED')
      }
    },
    onFailure: url => failures.push(url)
  })

  assert.equal(selected, 'file:///app.asar/dist/index.html')
  assert.deepEqual(attempts, ['file:///unpacked/index.html', 'file:///app.asar/dist/index.html'])
  assert.deepEqual(failures, ['file:///unpacked/index.html'])
})

test('renderer loading is bounded when every candidate fails', async () => {
  const attempts: string[] = []

  await assert.rejects(
    loadUrlCandidates({
      urls: ['first', 'second'],
      load: async url => {
        attempts.push(url)
        throw new Error(`failed ${url}`)
      }
    }),
    /failed second/
  )
  assert.deepEqual(attempts, ['first', 'second'])
})
