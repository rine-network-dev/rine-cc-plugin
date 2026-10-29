import type { EngineInterface } from 'claude-code'
import type { Tone } from '../lib/tone'

export type Ui = ReturnType<EngineInterface['ui']['resolve']>

/** The brand teal: legible on light and dark. Only the mark, the wordmark, the unread dot and section bars wear it. */
const BRAND = '#00BBA8'

type ToneProps = { color?: string; dimColor?: true }

const TONES: Record<Tone, ToneProps> = {
  plain: {},
  dim: { dimColor: true },
  brand: { color: BRAND },
  success: { color: 'success' },
  error: { color: 'error' },
  warning: { color: 'warning' },
  suggestion: { color: 'suggestion' }
}

/** One run of text in a tone. The text must already be fitted: this never measures or clips. */
export function toned(ui: Ui, key: string, text: string, tone: Tone = 'plain', isBold = false) {
  const { Text } = ui
  return (
    <Text key={key} bold={isBold ? true : undefined} {...TONES[tone]}>
      {text}
    </Text>
  )
}
