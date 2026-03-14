"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { marketsApi } from "@/lib/api/markets"
import { useAuthStore } from "@/lib/store/auth"
import { MarketResponse, PredictionResponse, BetPosition } from "@/types/api"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TrendingUp, TrendingDown, Clock, Users, Zap, Loader2 } from "lucide-react"
import { AxiosError } from "axios"

// ── Types ──────────────────────────────────────────────────────────────────────

interface MarketWithPrediction {
  market: MarketResponse
  prediction: PredictionResponse | null
}

interface BetState {
  marketId: number
  position: BetPosition
  market: MarketResponse
  prediction: PredictionResponse | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function useCountdown(target: string) {
  const [timeLeft, setTimeLeft] = useState("")
  useEffect(() => {
    const calc = () => {
      const diff = new Date(target).getTime() - Date.now()
      if (diff <= 0) return setTimeLeft("Closed")
      const h = Math.floor(diff / 3_600_000)
      const m = Math.floor((diff % 3_600_000) / 60_000)
      const s = Math.floor((diff % 60_000) / 1_000)
      setTimeLeft(h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`)
    }
    calc()
    const id = setInterval(calc, 1000)
    return () => clearInterval(id)
  }, [target])
  return timeLeft
}

function calcOdds(agree: string, disagree: string, side: BetPosition) {
  const a = parseFloat(agree) || 0
  const d = parseFloat(disagree) || 0
  const total = a + d
  if (total === 0) return "2.00"
  const pool = side === "agree" ? a : d
  if (pool === 0) return "∞"
  return (total / pool).toFixed(2)
}

function poolRatio(agree: string, disagree: string): number {
  const a = parseFloat(agree) || 0
  const d = parseFloat(disagree) || 0
  const total = a + d
  if (total === 0) return 50
  return Math.round((a / total) * 100)
}

// ── Bet Modal ──────────────────────────────────────────────────────────────────

function BetModal({ bet, onClose, onSuccess }: {
  bet: BetState
  onClose: () => void
  onSuccess: () => void
}) {
  const [amount, setAmount] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isAgree = bet.position === "agree"
  const odds = calcOdds(bet.market.total_agree_pool, bet.market.total_disagree_pool, bet.position)
  const potentialPayout = odds !== "∞" && amount
    ? (parseFloat(amount) * parseFloat(odds)).toFixed(2)
    : null

  const QUICK_AMOUNTS = [10, 25, 50, 100]

  const handleSubmit = async () => {
    const parsed = parseFloat(amount)
    if (!amount || isNaN(parsed) || parsed <= 0) { setError("Enter a valid amount"); return }
    if (parsed < 1) { setError("Minimum bet is 1 credit"); return }
    setIsLoading(true)
    setError(null)
    try {
      await marketsApi.placeBet(bet.marketId, { position: bet.position, amount: parsed.toFixed(2) })
      toast.success(`Bet placed! ${parsed} credits on ${bet.position}.`)
      onSuccess()
      onClose()
    } catch (err) {
      const e = err as AxiosError<{ detail: string }>
      setError(e.response?.data?.detail ?? "Failed to place bet. Try again.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            Place Bet — {bet.prediction?.asset ?? "Market"}
          </DialogTitle>
        </DialogHeader>

        <div className={`flex items-center gap-2.5 p-3 rounded-xl ${isAgree ? "bg-emerald-500/10" : "bg-rose-500/10"}`}>
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isAgree ? "bg-emerald-500/20" : "bg-rose-500/20"}`}>
            {isAgree
              ? <TrendingUp size={16} className="text-emerald-500" />
              : <TrendingDown size={16} className="text-rose-500" />
            }
          </div>
          <div>
            <div className={`text-sm font-semibold ${isAgree ? "text-emerald-600" : "text-rose-500"}`}>
              {isAgree ? "Agree — AI is correct" : "Disagree — AI is wrong"}
            </div>
            <div className="text-xs text-muted-foreground">{odds}x payout multiplier</div>
          </div>
        </div>

        <div className="flex gap-2">
          {QUICK_AMOUNTS.map((q) => (
            <button
              key={q}
              onClick={() => setAmount(String(q))}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                amount === String(q)
                  ? "bg-primary text-white border-primary"
                  : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {q}
            </button>
          ))}
        </div>

        <div className="space-y-1">
          <Input
            type="number"
            placeholder="Enter amount"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setError(null) }}
            className="h-12 text-base"
            min="1"
          />
          {error && <p className="text-xs text-destructive pl-1">{error}</p>}
          {potentialPayout && (
            <p className="text-xs text-muted-foreground pl-1">
              Potential payout: <span className="text-emerald-500 font-medium">{potentialPayout} credits</span>
            </p>
          )}
        </div>

        <Button
          onClick={handleSubmit}
          disabled={isLoading}
          className="w-full h-11 bg-primary hover:bg-primary/90 text-white font-medium"
        >
          {isLoading
            ? <span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Placing bet...</span>
            : `Bet ${amount || "0"} credits`
          }
        </Button>
      </DialogContent>
    </Dialog>
  )
}

// ── Market Card ────────────────────────────────────────────────────────────────

function MarketCard({ market, prediction, onBet }: {
  market: MarketResponse
  prediction: PredictionResponse | null
  onBet: (marketId: number, position: BetPosition, market: MarketResponse, prediction: PredictionResponse | null) => void
}) {
  const countdown = useCountdown(market.betting_closes_at)
  const isUp = prediction?.direction === "up"
  const isClosed = market.status !== "open" || countdown === "Closed"
  const agreeRatio = poolRatio(market.total_agree_pool, market.total_disagree_pool)
  const confidence = prediction ? Math.round(prediction.confidence * 100) : 0
  const agreeOdds = calcOdds(market.total_agree_pool, market.total_disagree_pool, "agree")
  const disagreeOdds = calcOdds(market.total_agree_pool, market.total_disagree_pool, "disagree")
  const totalPool = (parseFloat(market.total_agree_pool) + parseFloat(market.total_disagree_pool)).toFixed(0)

  return (
    <div className="bg-card rounded-2xl ring-1 ring-foreground/10 overflow-hidden hover:ring-primary/40 transition-all duration-200 hover:shadow-lg hover:shadow-primary/5 flex flex-col">

      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isUp ? "bg-emerald-500/10" : "bg-rose-500/10"}`}>
            {isUp
              ? <TrendingUp size={18} className="text-emerald-500" />
              : <TrendingDown size={18} className="text-rose-500" />
            }
          </div>
          <div>
            <div className="font-semibold text-foreground text-sm leading-tight">{prediction?.asset ?? "—"}</div>
            <div className={`text-xs font-medium mt-0.5 ${isUp ? "text-emerald-500" : "text-rose-500"}`}>
              AI predicts {isUp ? "↑ UP" : "↓ DOWN"}
            </div>
          </div>
        </div>
        <div className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${
          isClosed ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
        }`}>
          <Clock size={11} />
          <span>{isClosed ? "Closed" : countdown}</span>
        </div>
      </div>

      {/* Confidence + pool bar */}
      <div className="px-4 pb-3 space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Zap size={10} className="text-primary" /> AI Confidence</span>
          <span className="font-medium text-foreground">{confidence}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${isUp ? "bg-emerald-500" : "bg-rose-500"}`}
            style={{ width: `${confidence}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Users size={10} /> Pool</span>
          <span>{agreeRatio}% agree · {totalPool} credits</span>
        </div>
        <div className="h-1.5 rounded-full bg-rose-500/30 overflow-hidden">
          <div className="h-full rounded-full bg-emerald-500/70 transition-all" style={{ width: `${agreeRatio}%` }} />
        </div>
      </div>

      {/* Bet buttons */}
      <div className="px-4 pb-4 grid grid-cols-2 gap-2 mt-auto">
        <button
          onClick={() => onBet(market.id, "agree", market, prediction)}
          disabled={isClosed}
          className="flex flex-col items-center justify-center py-2.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 hover:border-emerald-500/40 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className="text-emerald-600 font-semibold text-sm">Agree</span>
          <span className="text-emerald-600/70 text-xs mt-0.5">{agreeOdds}x payout</span>
        </button>
        <button
          onClick={() => onBet(market.id, "disagree", market, prediction)}
          disabled={isClosed}
          className="flex flex-col items-center justify-center py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 hover:border-rose-500/40 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className="text-rose-500 font-semibold text-sm">Disagree</span>
          <span className="text-rose-400/70 text-xs mt-0.5">{disagreeOdds}x payout</span>
        </button>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function MarketsPage() {
  const router = useRouter()
  const { isAuthenticated } = useAuthStore()
  const [items, setItems] = useState<MarketWithPrediction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeBet, setActiveBet] = useState<BetState | null>(null)

  const load = useCallback(async () => {
    try {
      const markets = await marketsApi.getMarkets()
      const withPredictions = await Promise.all(
        markets.map(async (market) => {
          try {
            const prediction = await marketsApi.getPrediction(market.prediction_id)
            return { market, prediction }
          } catch {
            return { market, prediction: null }
          }
        })
      )
      setItems(withPredictions)
    } catch {
      setError("Failed to load markets.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleBet = (marketId: number, position: BetPosition, market: MarketResponse, prediction: PredictionResponse | null) => {
    if (!isAuthenticated) { router.push("/login"); return }
    setActiveBet({ marketId, position, market, prediction })
  }

  if (loading) {
    return (
      <div className="pt-8 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-card rounded-2xl ring-1 ring-foreground/10 h-56 animate-pulse" />
        ))}
      </div>
    )
  }

  if (error) return <div className="pt-8 text-center text-muted-foreground text-sm">{error}</div>

  return (
    <div className="pt-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Markets</h1>
        <p className="text-sm text-muted-foreground mt-0.5">AI made a prediction. Prove it wrong.</p>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          No open markets right now. Check back soon.
        </div>
      ) : (
        /* ── Responsive grid: 1 col mobile → 2 col desktop ── */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {items.map(({ market, prediction }) => (
            <MarketCard
              key={market.id}
              market={market}
              prediction={prediction}
              onBet={handleBet}
            />
          ))}
        </div>
      )}

      {activeBet && (
        <BetModal
          bet={activeBet}
          onClose={() => setActiveBet(null)}
          onSuccess={load}
        />
      )}
    </div>
  )
}