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

// ── Predictions ────────────────────────────────────────────────────────────────

export type Direction = "up" | "down"
export type PredictionOutcome = "pending" | "correct" | "incorrect"

export interface PredictionResponse {
  id: number
  asset: string
  direction: Direction
  confidence: number        // 0.0 – 1.0
  entry_price: string       // Decimal serialized as string
  timeframe_minutes: number
  outcome: PredictionOutcome
  generated_at: string      // ISO datetime
  expires_at: string        // ISO datetime
  resolved_at: string | null
}

// ── Markets ────────────────────────────────────────────────────────────────────

export type MarketStatus = "open" | "betting_closed" | "resolved" | "stale"
export type BetPosition = "agree" | "disagree"

export interface MarketResponse {
  id: number
  prediction_id: number
  status: MarketStatus
  total_agree_pool: string       // Decimal as string
  total_disagree_pool: string    // Decimal as string
  opened_at: string
  betting_closes_at: string
  prediction_target_time: string
  resolution_time: string
}

export interface PlaceBetRequest {
  position: BetPosition
  amount: string              // Decimal as string e.g. "10.00"
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
  balance: string             // Decimal as string
}

export interface WalletTransactionResponse {
  id: number
  amount: string              // negative for debits, positive for credits
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
  accuracy_pct: number        // 0.0 – 100.0
}

export interface TopTraderEntry {
  rank: number
  user_id: number
  email: string
  total_winnings: string      // Decimal as string
  total_bets: number
  win_rate_pct: number
}

export interface LeaderboardResponse {
  ai_accuracy: AIAccuracyResponse
  top_traders: TopTraderEntry[]
}

// ── API Error ──────────────────────────────────────────────────────────────────

// FastAPI returns { detail: string } on errors
export interface APIError {
  detail: string
}