import { runCLINVEXAFocusedFill } from '../electron/clinvexa-fill'

const [windowId, value] = process.argv.slice(2)
if (!windowId || !value) {throw new Error('usage: test-focused-fill-live <windowId> <value>')}

const result = await runCLINVEXAFocusedFill({windowId, text:value, label:'主诉'})
process.stdout.write(`${JSON.stringify(result)}\n`)
if (result.status !== 'filled') {process.exitCode = 1}
