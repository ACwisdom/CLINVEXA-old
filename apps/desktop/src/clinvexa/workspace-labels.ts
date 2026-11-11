import { useI18n } from '@/i18n'

const zh = {
  voicePreparing: '正在准备本地实时语音模型，就绪后可开始问诊。',
  screenTogether: '同时开启屏幕辅助，当前工作窗口发送至已配置的视觉模型', fillSuggestions: '查看建议并快捷填写', voiceSource: '已结合本次问诊记录',
  copilot: '视觉副驾驶', consultation: '问诊记录', skills: '医疗智能体', activity: '任务进度', rpa: '桌面操作',
  home: '返回主页面', workspace: '医生工作台', live: '边问诊，边整理',
  liveHelp: '录音持续转写，草稿随已识别内容更新；切换工作区不会中断记录。',
  starting: '正在开启麦克风', failed: '需要恢复处理', queue: '待处理音频段', retry: '重试待处理音频',
  noTranscript: '开始交谈后，已转写内容会持续出现在这里。',
  draftHelp: '这是待确认草稿。编辑后，后续识别不会覆盖您的修改。',
  finalize: '结束并核对草稿', copied: '已复制', copy: '复制草稿', copyError: '复制失败，请选中文本复制',
  all: '全部', installed: '已安装', available: '可安装', loading: '正在读取技能目录', refresh: '刷新目录',
  empty: '没有符合条件的技能', clear: '清除筛选', running: '处理中', showAssistant: '打开副驾驶',
  ready: '已转写内容保存在本机，医学建议和草稿仍需医生确认。',
  continueAgent: '交给医疗智能体',
}

type Labels = typeof zh

const en: Labels = {
  voicePreparing: 'Preparing local live speech recognition. Recording is available when ready.',
  screenTogether: 'Enable screen assistance; send the current work window to the configured vision model', fillSuggestions: 'Review suggestions and quick fill', voiceSource: 'Includes this consultation transcript',
  copilot: 'Screen copilot', consultation: 'Consultation', skills: 'Medical agents', activity: 'Task progress', rpa: 'Desktop actions',
  home: 'Back to home', workspace: 'Doctor workspace', live: 'Listen and document',
  liveHelp: 'Transcripts and drafts update during the visit. Switching views does not interrupt recording.',
  starting: 'Starting microphone', failed: 'Recovery needed', queue: 'Audio segments pending', retry: 'Retry pending audio',
  noTranscript: 'Recognized speech will appear here as the conversation proceeds.', draftHelp: 'Review draft. Your edits are preserved when new speech arrives.',
  finalize: 'Finish and review', copied: 'Copied', copy: 'Copy draft', copyError: 'Copy failed; select and copy the text',
  all: 'All', installed: 'Installed', available: 'Available', loading: 'Loading skill catalog', refresh: 'Refresh catalog',
  empty: 'No matching skills', clear: 'Clear filters', running: 'Processing', showAssistant: 'Open copilot',
  ready: 'Transcripts are saved locally. Medical suggestions and drafts require physician review.', continueAgent: 'Send to medical agent',
}

const hant: Labels = { ...zh, voicePreparing: '正在準備本機即時語音模型，就緒後可開始問診。', screenTogether: '同時開啟螢幕輔助，將目前工作視窗傳送至已設定的視覺模型', fillSuggestions: '查看建議並快捷填寫', voiceSource: '已結合本次問診記錄', copilot: '視覺副駕駛', consultation: '問診記錄', skills: '醫療智能體', activity: '任務進度', rpa: '桌面操作', home: '返回主頁面', workspace: '醫生工作台', live: '邊問診，邊整理', liveHelp: '錄音持續轉寫，草稿隨已識別內容更新；切換工作區不會中斷記錄。', starting: '正在開啟麥克風', failed: '需要恢復處理', queue: '待處理音訊段', retry: '重試待處理音訊', noTranscript: '開始交談後，已轉寫內容會持續顯示在這裡。', draftHelp: '這是待確認草稿。編輯後，後續識別不會覆蓋您的修改。', finalize: '結束並核對草稿', copied: '已複製', copy: '複製草稿', copyError: '複製失敗，請選取文字複製', all: '全部', installed: '已安裝', available: '可安裝', loading: '正在讀取技能目錄', refresh: '重新整理目錄', empty: '沒有符合條件的技能', clear: '清除篩選', running: '處理中', showAssistant: '開啟副駕駛', ready: '已轉寫內容儲存在本機，醫學建議和草稿仍需醫生確認。', continueAgent: '交給醫療智慧助理' }
const ja: Labels = { ...en, voicePreparing: '端末の音声認識モデルを準備中です。準備が完了すると録音できます。', screenTogether: '画面支援を開始し、現在の作業画面を設定済みの視覚モデルへ送信', fillSuggestions: '提案を確認して入力', voiceSource: '今回の診察記録を参照', copilot: '画面アシスタント', consultation: '診察記録', skills: '医療エージェント', activity: 'タスク進捗', rpa: 'デスクトップ操作', home: 'ホームへ戻る', workspace: '医師ワークスペース', live: '診察しながら記録', liveHelp: '会話中に文字起こしと下書きを更新します。画面を切り替えても録音は継続します。', starting: 'マイクを起動中', failed: '処理の復旧が必要です', queue: '未処理の音声区間', retry: '音声処理を再試行', noTranscript: '認識した会話がここに表示されます。', draftHelp: '確認用の下書きです。編集内容は以降の認識で上書きされません。', finalize: '終了して下書きを確認', copied: 'コピーしました', copy: '下書きをコピー', copyError: 'コピーに失敗しました。テキストを選択してコピーしてください。', all: 'すべて', installed: 'インストール済み', available: '利用可能', loading: 'スキルを読み込み中', refresh: '一覧を更新', empty: '一致するスキルがありません', clear: '絞り込みを解除', running: '処理中', showAssistant: 'アシスタントを開く', ready: '文字起こしは端末に保存されます。医学的な提案と下書きは医師が確認してください。', continueAgent: '医療エージェントに送る' }

export function useWorkspaceLabels(): Labels {
  const { locale } = useI18n()

  return ({ zh, 'zh-hant': hant, en, ja, ar: en })[locale]
}
