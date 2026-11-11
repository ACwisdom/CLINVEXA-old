import { runCLINVEXAQuickFill } from '../electron/clinvexa-fill'

const [windowId, title] = process.argv.slice(2)
const skipIdentity = process.argv.includes('--skip-identity')

if (!windowId || !title) {throw new Error('usage: test-quick-fill-live <windowId> <title>')}

const result = await runCLINVEXAQuickFill({
  windowId,
  title,
  patientId: skipIdentity ? '' : 'DC-DEMO-0001',
  encounterId: skipIdentity ? '' : 'DC-OP-20260916',
  fields: [
    { label:'主诉', text:'右上腹阵发性疼痛 3 天，伴发热、恶心和呕吐。' },
    { label:'现病史', text:'3 天前进食油腻食物后出现右上腹阵发性绞痛，伴恶心、呕吐 2 次；昨晚体温最高 39.0℃。' },
    { label:'过敏史', text:'青霉素类药物过敏，既往使用后出现全身皮疹。' },
    { label:'辅助检查', text:'腹部彩超提示胆囊多发结石，胆囊壁增厚；建议完善血常规、肝功能、胆红素、淀粉酶及 CRP。' },
    { label:'初步诊断', text:'考虑急性胆囊炎（待医生确认）。' }
  ]
})

process.stdout.write(`${JSON.stringify(result)}\n`)
if (result.status !== 'filled' || result.fields.length !== 5 || result.fields.some(field => field.status !== 'filled')) {process.exitCode = 1}
