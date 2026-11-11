import { chromium } from '@playwright/test'
import path from 'node:path'
const browser = await chromium.launch({channel:'msedge',headless:true})
try {
  const page = await browser.newPage({viewport:{width:1200,height:950}})
  const labels = ['主诉','现病史','既往史','体格检查','辅助检查']
  const facts = ['口渴、多饮 3 个月。','患者自述近 3 个月口渴、多饮，无发热，无胸痛。','高血压病史 5 年；药物过敏史未提供。','体温 36.5 ℃，脉搏 78 次/分，血压 128/76 mmHg。','2026-09-01 空腹血糖 8.2 mmol/L，糖化血红蛋白 7.1%。']
  await page.setContent(`<html lang="zh"><meta charset="utf-8"><style>body{font:18px 'Microsoft YaHei';padding:25px;color:#173151;background:#f3f6fa}h1{font-size:24px}aside{background:white;padding:16px}p{margin:10px 0}label{display:grid;grid-template-columns:130px 1fr;margin:12px 0}textarea{height:48px;border:1px solid #cad5e5}</style><h1>合成 HIS 软件测试 · 病历书写</h1><h2>测试小王 · 患者 SYNTH-A · 就诊 SYNTH-E1</h2><aside>${facts.map((s,i)=>`<p>${labels[i]}：${s}</p>`).join('')}</aside>${labels.map(label=>`<label>${label}<textarea aria-label="${label}"></textarea></label>`).join('')}<p>以上均为合成资料，无真实患者。</p></html>`)
  await page.screenshot({path:path.resolve(import.meta.dirname,'../../../../.codex-work/copilot-v12-acceptance/synthetic-rich-case.png')})
} finally {await browser.close()}
