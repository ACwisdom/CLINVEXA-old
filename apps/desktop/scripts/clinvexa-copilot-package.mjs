import { build, Platform, Arch } from 'electron-builder'
import path from 'node:path'
const desktop=path.resolve(import.meta.dirname,'..')
process.chdir(desktop)
await build({targets:Platform.WINDOWS.createTarget('dir',Arch.x64),config:{directories:{output:path.join(desktop,'release-copilot-v12')},electronDist:path.resolve(desktop,'../../node_modules/electron/dist')}})
