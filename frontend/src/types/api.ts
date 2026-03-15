// ── Auth ───────────────────────────────────────────────────────────────────────

export interface RegisterRequest {
  email: string
  password: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface TokenResponse {
  access_token: string
  token_type: string
}

export interface UserResponse {
  id: number
  email: string
}

// ── Agents ─────────────────────────────────────────────────────────────────────

export interface AgentResponse {
  id: number
  user_id: number
  name: string
  is_active: boolean
  created_at: string
}

export interface AgentDetailResponse extends AgentResponse {
  code: string
}

export interface AgentUploadRequest {
  name: string
  file: File
}

// ── Predictions ────────────────────────────────────────────────────────────────

export type Direction = "up" | "down"
export type PredictionOutcome = "pending" | "correct" | "incorrect"

export interface PredictionResponse {
  id: number
  asset: string
  direction: Direction
  confidence: number
  entry_price: string
  timeframe_minutes: number
  outcome: PredictionOutcome
  generated_at: string
  expires_at: string
  resolved_at: string | null
  agent_id: number | null
}

// ── Markets ────────────────────────────────────────────────────────────────────

export type MarketStatus = "open" | "betting_closed" | "resolved" | "stale"
export type BetPosition = "agree" | "disagree"

export interface MarketResponse {
  id: number
  prediction_id: number
  status: MarketStatus
  total_agree_pool: string
  total_disagree_pool: string
  opened_at: string
  betting_closes_at: string
  prediction_target_time: string
  resolution_time: string
  asset: string
  direction: Direction
  confidence: number
  entry_price: string
  outcome: PredictionOutcome
  agent_id: number | null
  agent_name: string | null
}

export interface PlaceBetRequest {
  position: BetPosition
  amount: string
}

export interface BetResponse {
  id: number
  market_id: number
  user_id: number
  position: BetPosition
  amount: string
  payout: string | null
  placed_at: string
}

// ── Wallet ─────────────────────────────────────────────────────────────────────

export type TransactionType = "starting_credit" | "bet_debit" | "win_credit" | "refund"

export interface WalletBalanceResponse {
  user_id: number
  balance: string
}

export interface WalletTransactionResponse {
  id: number
  amount: string
  type: TransactionType
  reference_id: number | null
  created_at: string
}

export interface WalletHistoryResponse {
  transactions: WalletTransactionResponse[]
  total: number
}

// ── Leaderboard ────────────────────────────────────────────────────────────────

export interface AIAccuracyResponse {
  total_predictions: number
  correct: number
  incorrect: number
  pending: number
  accuracy_pct: number
}

export interface TopTraderEntry {
  rank: number
  user_id: number
  email: string
  total_winnings: string
  total_bets: number
  win_rate_pct: number
}

export interface LeaderboardResponse {
  ai_accuracy: AIAccuracyResponse
  top_traders: TopTraderEntry[]
}

// ── API Error ──────────────────────────────────────────────────────────────────

export interface APIError {
  detail: string
}