export type Binding = { sessionId: string; cardId: string }
export type Health = { fails: number; until: number }

// What the line above the prompt draws from: the card as the last response showed it.
export type BandCard = {
  id: string
  title: string
  status: string
  priority: string | null
  agent: string | null
  branch: string | null
  notes: number
  lastNote: string | null
}

// linked = bound to a card; the other three are "nothing was claimed" and say why.
export type BandState =
  | { kind: 'linked'; card: BandCard }
  | { kind: 'none' }
  | { kind: 'many'; ids: string[] }
  | { kind: 'held'; id: string; agent: string }

// The first session's one-time line (AB-23), shown until its first turn ends.
export type Welcome = { kind: 'connected'; url: string } | { kind: 'offline' }

declare module 'claude-code' {
  interface PluginState {
    'agent-board': {
      binding: Binding | null
      lastNotedTurnId: string | null
      health: Health
      band: BandState | null
      welcome: Welcome | null
      // /board-sync off with offScope "session" (D21): gone with the session.
      sessionOff: boolean
      // A "which card?" question was already asked this session (hot reload must not ask again).
      asked: boolean
    }
  }
}
