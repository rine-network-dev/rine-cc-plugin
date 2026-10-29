import type { ClientModule } from 'claude-code'

type Props = { frames: readonly string[]; periodMs: number; color?: string }

/**
 * One glyph cycling through `frames` every `periodMs` on the surface's own frame clock: the live dot's pulse and the
 * spinner. The hooks module hands in the frames, so the glyph tables have one home (`lib/motion.ts`), and it never
 * sees a tick. The first frame is the resting one.
 */
const Cycle: ClientModule<Props, number> = (props, surface) => {
  const { Text } = surface.elements
  if (surface.state === undefined) surface.every(props.periodMs, () => surface.setState((surface.state ?? 0) + 1))
  const frame = props.frames[(surface.state ?? 0) % props.frames.length]
  return <Text color={props.color}>{frame}</Text>
}

export default Cycle
