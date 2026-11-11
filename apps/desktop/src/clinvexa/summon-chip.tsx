import { Button } from '@/components/ui/button'
import { Brain, X } from '@/lib/icons'
import { removeAssistant, type SummonedAssistant } from './summon'

export function SummonChip({ assistant, preparing }: { assistant: SummonedAssistant; preparing: boolean }) {
  return (
    <div className="dc-summon-context" data-slot="summoned-assistant">
      <div className="dc-summon-chip">
        <Brain aria-hidden size={16} />
        <span>{assistant.name}</span>
        <Button
          aria-label={`移除 ${assistant.name}`}
          disabled={preparing}
          onClick={() => removeAssistant(assistant)}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <X />
        </Button>
      </div>
      <span className="text-xs text-muted-foreground" role="status">
        {preparing ? '正在核验并加载助手…' : '已召唤 · 输入任务即可开始'}
      </span>
    </div>
  )
}
