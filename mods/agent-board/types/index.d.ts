export type Binding = { sessionId: string; cardId: string }
export type Health = { fails: number; until: number }

declare module 'claude-code' {
  interface PluginState {
    'agent-board': {
      binding: Binding | null
      lastNotedTurnId: string | null
      health: Health
    }
  }
}
