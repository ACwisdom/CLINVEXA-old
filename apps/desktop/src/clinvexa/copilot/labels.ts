import { useI18n } from '@/i18n'

const zh = {
  currentFailure: '当前画面分析未完成', savedUnaffected: '下方是先前已保存的结果，不受本次错误影响。',
  resultHistory:'结果与草稿历史',historical:'正在查看历史结果',pausedResult:'看屏已暂停，结果仅供查看和复制。',
  compare:'更新对照',previousDraft:'先前草稿',noPrevious:'同患者、同就诊有先前结果后，可在此对照更新。',noChanges:'已识别字段没有新的文本变化。',mergeHelp:'与已读字段原文精确匹配时替换，否则追加建议并保留原稿。采用后请在编辑区核对并保存。',applyUpdates:'采用所选，进入编辑',
  copilot: '医生副驾驶', open: '打开 CLINVEXA', drag: '拖动 CLINVEXA', workbench: '打开工作台', collapse: '收起助手',
  off: '看屏已关闭', watching: '关注当前画面', analyzing: '正在理解画面', ready: '建议已就绪', error: '需要处理',
  start: '开启看屏', pause: '暂停看屏', refresh: '重新读取',
  welcome: '让助手跟上你的工作', introduction: '打开病历、报告或文献后，助手会识别当前需求并给出建议。',
  disclosure: '开启后，当前工作窗口的画面将发送到已配置的视觉模型。可随时暂停。',
  suggestions: '当前建议', material: '已读资料', ask: '追问',
  noWindow: '请切换到需要辅助的窗口', current: '当前工作窗口', scope: '仅基于可见画面和本次加入的资料',
  stale: '画面或问诊资料已更新。旧结果可查看和复制，填写前请重新读取。', patientUnknown: '当前患者身份未完整识别',
  patient: '患者', encounter: '就诊', elapsed: '已等待', seconds: '秒',
  empty: '有可用结果时会显示在这里', evidence: '理由与依据', reason: '建议理由', facts: '已读事实', missing: '待核对信息',
  source: '医学来源', noSource: '尚未接入已审核医学资料。可整理病例；具体检查建议等待有效依据。',
  copy: '复制', fill: '快捷填写', copySelected: '复制所选', fillSelected: '填写所选', select: '选择', selected: '已选择',
  target: '目标字段', noTarget: '未定位目标，可复制使用', dismiss: '忽略建议', followup: '继续追问',
  fillNotice: '优先直接填写；系统无法安全定位字段时会自动复制，您可在目标输入框按 Ctrl+V。不会提交或开具。',
  fillModeTitle:'将这份结果填写到其他页面',fillModeHelp:'先保留本次结果，再切换到需要填写的系统。副驾驶不会覆盖这份结果。',startFillMode:'保留本结果可实现快捷填写',fillModeActive:'本次结果已保留',fillSwitchTarget:'请先点击系统中需要填写的输入框，再打开悬浮球选择任意一条“快捷填写”。',fillTargetReady:'先点击系统中需要填写的输入框，再点击下方任意一条“快捷填写”；无需页面标题或建议标题一致。',fillTarget:'最近点击的系统窗口',stopFillMode:'结束填写',
  question: '基于识别结果继续处理', questionPlaceholder: '例如：提取文档关键信息并整理，或分析患者现有症状',
  sourceText: '补充资料（可选）', sourcePlaceholder: '可粘贴文档原文或其他资料；涉及患者时请核对身份。',
  send: '发送并分析', close: '关闭工作台', history: '最近任务', refreshHistory: '刷新任务',
  result: '运行结果', progress: '任务与进度', draft: '医生草稿', proposed: 'AI 建议', save: '保存草稿', saved: '草稿已保存',
  copyDraft: '复制草稿', copied: '已复制，可按 Ctrl+V 粘贴', merge: '查看更新', original: '来源摘录',
  sourceChanged: '画面已变化。请核对补充资料仍适用于当前画面，再用于分析。', rebindSource: '已核对，用于当前画面',
  versions: '历史草稿', restore: '载入编辑区', sourceTitle: '资料标题', sourceVersion: '版本或发布日期', reviewer: '审核人', sourceUrl: '原文链接（可选）', sourceContent: '适用范围与依据原文', reviewed: '我已核对来源、适用范围和版本，同意作为辅助分析依据', addSource: '保存依据资料', sourceSaved: '依据已保存，下次分析生效',
  draftHelp: '在这里编辑结果。AI 后续更新不会覆盖已保存的医生草稿。',
  revision: '草稿版本', errorRetry: '操作未完成，请重试', processing: '正在操作', knowledge: '依据资料',
  libraryHelp: '已审核来源由本地知识库提供；每份包含标题、版本、审核人和审核时间。',
  noHistory: '尚无已保存的结果', screenRead: '画面读取', visualAnalysis: '视觉分析', resultReady: '结果已保存',
  allResults: '副驾驶任务', tools: '功能', clinical: '临床协助', learning: '科研与学习', office: '行政办公',
  duration: '分析耗时', sourceDate: '读取时间', noSuggestions: '暂无可直接使用的建议，请查看资料缺口或继续追问。'
}

type Labels = { [K in keyof typeof zh]: string }

const en: Labels = {
  currentFailure: 'Current screen analysis failed', savedUnaffected: 'The saved result below is unaffected by this error.',
  resultHistory:'Result and draft history',historical:'Viewing a historical result',pausedResult:'Screen assistance paused. Results remain available to read and copy.',
  compare:'Compare',previousDraft:'Previous draft',noPrevious:'Comparison is available after an earlier result for the same patient and encounter.',noChanges:'No changed field text found.',mergeHelp:'Only exact original field text is replaced. Otherwise suggestions are appended, preserving the draft. Review and save in the editor.',applyUpdates:'Apply selected and edit',
  sourceChanged:'The screen changed. Check that this material still belongs to the current patient and encounter.',rebindSource:'Checked: use with this screen',versions:'Draft history',restore:'Load into editor',sourceTitle:'Source title',sourceVersion:'Version or publication date',reviewer:'Reviewer',sourceUrl:'Original URL (optional)',sourceContent:'Scope and original evidence',reviewed:'I checked the source, scope and version for use as supporting evidence.',addSource:'Save evidence',sourceSaved:'Evidence saved for the next analysis',
  copilot:'Doctor copilot',open:'Open CLINVEXA',drag:'Drag CLINVEXA',workbench:'Open workspace',collapse:'Collapse assistant',
  off:'Screen assistance off',watching:'Watching current window',analyzing:'Understanding the screen',ready:'Suggestions ready',error:'Needs attention',
  start:'Start screen assistance',pause:'Pause',refresh:'Read again',welcome:'An assistant alongside your work',
  introduction:'Open a record, report or article to receive context-aware assistance.',disclosure:'When enabled, the current work window is sent to your configured vision model. Pause at any time.',
  suggestions:'Suggestions',material:'Read material',ask:'Ask',noWindow:'Switch to the window you need help with',current:'Current work window',scope:'Based only on visible content and material added here',
  stale:'The screen or consultation changed. Previous results remain available to read and copy. Read again before filling.',patientUnknown:'Patient identity is incomplete',patient:'Patient',encounter:'Encounter',elapsed:'Waiting',seconds:'s',
  empty:'Results will appear here',evidence:'Reason and evidence',reason:'Reason',facts:'Observed facts',missing:'Needs checking',source:'Medical sources',noSource:'No reviewed medical sources configured. Record structuring is available; specific examination suggestions require evidence.',
  copy:'Copy',fill:'Quick fill',copySelected:'Copy selected',fillSelected:'Fill selected',select:'Select',selected:'Selected',target:'Target field',noTarget:'No target located; copy is available',dismiss:'Dismiss',followup:'Ask more',
  fillNotice:'Direct fill is attempted first. If the field cannot be located safely, the content is copied for Ctrl+V. Nothing is submitted or ordered.',question:'Ask about this material',questionPlaceholder:'Summarize the record. What information needs checking?',sourceText:'Add material for this screen',sourcePlaceholder:'Paste material for this patient after checking their identity.',
  fillModeTitle:'Fill this result into another page',fillModeHelp:'Keep this result, then switch to the HIS. The assistant will not replace it.',startFillMode:'Keep result and fill HIS',fillModeActive:'This result is kept',fillSwitchTarget:'Click the input you want in the HIS, then open the assistant and choose any Quick fill item.',fillTargetReady:'Click the intended HIS input first, then choose any Quick fill item below. Page and suggestion titles do not need to match.',fillTarget:'Last system window',stopFillMode:'Finish filling',
  send:'Analyze current screen',close:'Close workspace',history:'Recent tasks',refreshHistory:'Refresh tasks',result:'Results',progress:'Task and progress',draft:'Doctor draft',proposed:'AI suggestions',save:'Save draft',saved:'Draft saved',copyDraft:'Copy draft',copied:'Copied. Paste with Ctrl+V.',merge:'Review update',original:'Source material',draftHelp:'Edit here. Later AI updates do not overwrite your saved draft.',revision:'Draft revision',errorRetry:'Action failed. Please retry.',processing:'Working',knowledge:'Evidence library',libraryHelp:'Reviewed local sources include title, version, reviewer and review date.',noHistory:'No saved results yet',screenRead:'Screen captured',visualAnalysis:'Visual analysis',resultReady:'Result saved',allResults:'Copilot tasks',tools:'Functions',clinical:'Clinical assistance',learning:'Research and learning',office:'Office work',duration:'Analysis time',sourceDate:'Captured',noSuggestions:'No usable suggestions yet. Review missing information or ask a question.'
}

const hant: Labels = { ...zh, copilot:'醫師副駕駛',open:'開啟 CLINVEXA',drag:'拖動 CLINVEXA',workbench:'開啟工作台',collapse:'收起助手',off:'看屏已關閉',watching:'關注當前畫面',analyzing:'正在理解畫面',ready:'建議已就緒',error:'需要處理',start:'開啟看屏',pause:'暫停看屏',refresh:'重新讀取',suggestions:'當前建議',material:'已讀資料',ask:'追問',copy:'複製',fill:'快捷填寫',copySelected:'複製所選',fillSelected:'填寫所選',draft:'醫師草稿',save:'儲存草稿',saved:'草稿已儲存',patient:'患者',encounter:'就診',source:'醫學來源',facts:'已讀事實',missing:'待核對資訊',sourceText:'補充當前病例資料',send:'分析當前畫面',history:'最近任務',result:'執行結果',progress:'任務與進度',close:'關閉工作台' }
const ja: Labels = { ...en, copilot:'医師コパイロット',open:'CLINVEXA を開く',drag:'CLINVEXA を移動',workbench:'ワークスペースを開く',collapse:'折りたたむ',off:'画面支援は停止中',watching:'現在の画面を確認中',analyzing:'画面を分析中',ready:'提案があります',error:'確認が必要です',start:'画面支援を開始',pause:'一時停止',refresh:'再読込',suggestions:'提案',material:'読込資料',ask:'質問',copy:'コピー',fill:'クイック入力',copySelected:'選択をコピー',fillSelected:'選択を入力',draft:'医師の下書き',save:'下書きを保存',saved:'保存しました',patient:'患者',encounter:'受診',source:'医学的根拠',facts:'確認した事実',missing:'確認事項',sourceText:'現在の患者の資料を追加',send:'現在の画面を分析',history:'最近のタスク',result:'結果',progress:'タスクと進行状況',close:'ワークスペースを閉じる' }

export function useCopilotLabels(): Labels {
  const { locale } = useI18n()

  return ({ zh, 'zh-hant': hant, en, ja, ar: en })[locale]
}
