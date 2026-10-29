export type SpikeRev = number
declare module 'claude-code' {
  interface PluginState {
    'spike-client': { rev: SpikeRev }
  }
}
