import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const desktopRoot = path.resolve(import.meta.dirname, '..')
const sourceDir = path.join(desktopRoot, 'release', 'win-unpacked')
const outputDir = path.join(desktopRoot, 'release')
const iconFile = path.join(desktopRoot, 'assets', 'icon.ico')
const scriptFile = path.join(import.meta.dirname, 'clinvexa-installer.iss')
const fsPromises = await import('node:fs/promises')
const packageJson = JSON.parse(await fsPromises.readFile(path.join(desktopRoot, 'package.json'), 'utf8'))
const installerScript = await fsPromises.readFile(scriptFile, 'utf8')

// Reusing an old Inno Setup directory can silently keep a temporary or
// developer build as the user's active CLINVEXA entrance.  Refuse to create
// a release unless upgrades are pinned to the canonical per-user directory.
if (!/^UsePreviousAppDir=no\s*$/im.test(installerScript)) {
  throw new Error('CLINVEXA installer must set UsePreviousAppDir=no to prevent stale software entrances')
}

const candidates = [
  process.env.INNO_SETUP_COMPILER,
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Inno Setup 6', 'ISCC.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Inno Setup 6', 'ISCC.exe')
].filter(Boolean)
const compiler = candidates.find(existsSync)

if (!existsSync(path.join(sourceDir, 'CLINVEXA.exe'))) {
  throw new Error(`Software A is missing: ${path.join(sourceDir, 'CLINVEXA.exe')}. Run npm run pack first.`)
}
if (!compiler) {
  throw new Error(
    'Inno Setup 6 compiler was not found. Install it with: ' +
      'winget install --id JRSoftware.InnoSetup --exact --silent --scope user'
  )
}

const args = [
  `/DSourceDir=${sourceDir}`,
  `/DOutputDir=${outputDir}`,
  `/DIconFile=${iconFile}`,
  `/DAppVersion=${packageJson.version}`,
  scriptFile
]
const result = spawnSync(compiler, args, { cwd: desktopRoot, encoding: 'utf8', windowsHide: true })
process.stdout.write(result.stdout || '')
process.stderr.write(result.stderr || '')
if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
