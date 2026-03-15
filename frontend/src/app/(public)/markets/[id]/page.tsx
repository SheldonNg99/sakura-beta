"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { marketsApi } from "@/lib/api/markets"
import { useAuthStore } from "@/lib/store/auth"
import { MarketResponse, BetPosition } from "@/types/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AxiosError } from "axios"
import {
  TrendingUp,
  TrendingDown,
  Clock,
  Bot,
  Users,
  Zap,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react"

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

function poolRatio(agree: string, disagree: string): number {
  const a = parseFloat(agree) || 0
  const d = parseFloat(disagree) || 0
  const total = a + d
  if (total === 0) return 50
  return Math.round((a / total) * 100)
}

function calcOdds(agree: string, disagree: string, side: BetPosition): string {
  const a = parseFloat(agree) || 0
  const d = parseFloat(disagree) || 0
  const total = a + d
  if (total === 0) return "2.00"
  const pool = side === "agree" ? a : d
  if (pool === 0) return "∞"
  return (total / pool).toFixed(2)
}

function formatPrice(p: string): string {
  return parseFloat(p).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Bet Panel ──────────────────────────────────────────────────────────────────

function BetPanel({ market, onSuccess }: { market: MarketResponse; onSuccess: () => void }) {
  const router = useRouter()
  const { isAuthenticated } = useAuthStore()
  const [side, setSide] = useState<BetPosition>("agree")
  const [amount, setAmount] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isClosed = market.status !== "open"
  const isUp = market.direction === "up"
  const agreeOdds = calcOdds(market.total_agree_pool, market.total_disagree_pool, "agree")
  const disagreeOdds = calcOdds(market.total_agree_pool, market.total_disagree_pool, "disagree")
  const currentOdds = side === "agree" ? agreeOdds : disagreeOdds
  const potentialPayout = currentOdds !== "∞" && amount
    ? (parseFloat(amount) * parseFloat(currentOdds)).toFixed(2)
    : null

  const QUICK = [10, 25, 50, 100]

  const handleBet = async () => {
    if (!isAuthenticated) { router.push("/login"); return }
    const parsed = parseFloat(amount)
    if (!amount || isNaN(parsed) || parsed < 1) { setError("Minimum bet is 1 credit"); return }
    setIsLoading(true)
    setError(null)
    try {
      await marketsApi.placeBet(market.id, { position: side, amount: parsed.toFixed(2) })
      toast.success(`Bet placed! ${parsed} credits on ${side === "agree" ? "Agree" : "Disagree"}.`)
      setAmount("")
      onSuccess()
    } catch (err) {
      const e = err as AxiosError<{ detail: string }>
      setError(e.response?.data?.detail ?? "Failed to place bet. Try again.")
    } finally {
      setIsLoading(false)
    }
  }

  if (isClosed) {
    return (
      <div className="bg-card rounded-2xl ring-1 ring-foreground/10 p-5 text-center space-y-2">
        <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center mx-auto">
          <Clock size={18} className="text-muted-foreground" />
        </div>
        <p className="text-sm font-semibold text-foreground">Betting Closed</p>
        <p className="text-xs text-muted-foreground">
          {market.status === "resolved"
            ? `Market resolved — ${market.outcome}`
            : "Awaiting resolution"}
        </p>
      </div>
    )
  }

  return (
    <div className="bg-card rounded-2xl ring-1 ring-foreground/10 overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <p className="text-sm font-semibold text-foreground">Place Your Bet</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Do you think the agent is right?
        </p>
      </div>

      <div className="p-5 space-y-4">
        {/* Side selector */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setSide("agree")}
            className={`flex flex-col items-center py-3 rounded-xl border-2 transition-all ${
              side === "agree"
                ? "border-emerald-500 bg-emerald-500/10"
                : "border-border hover:border-emerald-500/40"
            }`}
          >
            <CheckCircle2 size={18} className={side === "agree" ? "text-emerald-500" : "text-muted-foreground"} />
            <span className={`text-sm font-bold mt-1 ${side === "agree" ? "text-emerald-600" : "text-muted-foreground"}`}>
              Agree
            </span>
            <span className={`text-xs mt-0.5 ${side === "agree" ? "text-emerald-600/70" : "text-muted-foreground/60"}`}>
              {agreeOdds}x payout
            </span>
          </button>
          <button
            onClick={() => setSide("disagree")}
            className={`flex flex-col items-center py-3 rounded-xl border-2 transition-all ${
              side === "disagree"
                ? "border-rose-500 bg-rose-500/10"
                : "border-border hover:border-rose-500/40"
            }`}
          >
            <XCircle size={18} className={side === "disagree" ? "text-rose-500" : "text-muted-foreground"} />
            <span className={`text-sm font-bold mt-1 ${side === "disagree" ? "text-rose-500" : "text-muted-foreground"}`}>
              Disagree
            </span>
            <span className={`text-xs mt-0.5 ${side === "disagree" ? "text-rose-400/70" : "text-muted-foreground/60"}`}>
              {disagreeOdds}x payout
            </span>
          </button>
        </div>

        {/* Quick amounts */}
        <div className="grid grid-cols-4 gap-1.5">
          {QUICK.map((q) => (
            <button
              key={q}
              onClick={() => setAmount(String(q))}
              className={`py-1.5 rounded-lg text-xs font-medium border transition-all ${
                amount === String(q)
                  ? "bg-primary text-white border-primary"
                  : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {q}
            </button>
          ))}
        </div>

        {/* Amount input */}
        <div className="space-y-1">
          <Input
            type="number"
            placeholder="Enter amount (credits)"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setError(null) }}
            className="h-11 text-base"
            min="1"
          />
          {error && <p className="text-xs text-destructive pl-1">{error}</p>}
          {potentialPayout && !error && (
            <p className="text-xs text-muted-foreground pl-1">
              Potential payout:{" "}
              <span className="text-emerald-500 font-semibold">{potentialPayout} credits</span>
            </p>
          )}
        </div>

        {/* Submit */}
        <Button
          onClick={handleBet}
          disabled={isLoading}
          className={`w-full h-11 font-semibold text-white ${
            side === "agree"
              ? "bg-emerald-500 hover:bg-emerald-600"
              : "bg-rose-500 hover:bg-rose-600"
          }`}
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Placing bet...
            </span>
          ) : (
            `${side === "agree" ? "Agree" : "Disagree"} · ${amount || "0"} credits`
          )}
        </Button>

        {!isAuthenticated && (
          <p className="text-xs text-center text-muted-foreground">
            You need to{" "}
            <a href="/login" className="text-primary font-medium">sign in</a>{" "}
            to place a bet
          </p>
        )}
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function MarketDetailPage() {
  const params = useParams()
  const router = useRouter()
  const marketId = Number(params.id)

  const [market, setMarket] = useState<MarketResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await marketsApi.getMarket(marketId)
      setMarket(data)
    } catch {
      setError("Market not found.")
    } finally {
      setLoading(false)
    }
  }, [marketId])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="pt-8 max-w-4xl mx-auto space-y-4">
        <div className="h-8 w-32 bg-muted rounded-lg animate-pulse" />
        <div className="h-48 bg-card rounded-2xl animate-pulse" />
        <div className="h-64 bg-card rounded-2xl animate-pulse" />
      </div>
    )
  }

  if (error || !market) {
    return (
      <div className="pt-8 text-center text-muted-foreground text-sm space-y-3">
        <p>{error ?? "Market not found."}</p>
        <button onClick={() => router.back()} className="text-primary text-sm font-medium">
          ← Back to markets
        </button>
      </div>
    )
  }

  const isUp = market.direction === "up"
  const confidence = Math.round(market.confidence * 100)
  const agreeRatio = poolRatio(market.total_agree_pool, market.total_disagree_pool)
  const totalPool = (
    parseFloat(market.total_agree_pool) + parseFloat(market.total_disagree_pool)
  ).toFixed(0)
  const countdown = market.betting_closes_at

  return (
    <div className="pt-6 pb-12 max-w-4xl">

      {/* Back */}
      <button
        onClick={() => router.push("/markets")}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-5"
      >
        <ArrowLeft size={15} /> All markets
      </button>

      {/* ── Main layout: left content + right bet panel ── */}
      <div className="lg:grid lg:grid-cols-5 lg:gap-6 space-y-4 lg:space-y-0 lg:items-start">

        {/* ── Left: market info (3/5) ── */}
        <div className="lg:col-span-3 space-y-4">

          {/* Agent + headline */}
          <div className="bg-card rounded-2xl ring-1 ring-foreground/10 p-5">
            {/* Agent */}
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                <Bot size={15} className="text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Agent</p>
                <p className="text-sm font-bold text-primary">
                  {market.agent_name ?? "System Agent"}
                </p>
              </div>
              <div className="ml-auto">
                {market.status === "open" ? (
                  <LiveCountdown target={market.betting_closes_at} />
                ) : (
                  <span className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded-full font-medium">
                    {market.status}
                  </span>
                )}
              </div>
            </div>

            {/* Headline */}
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                isUp ? "bg-emerald-500/10" : "bg-rose-500/10"
              }`}>
                {isUp
                  ? <TrendingUp size={24} className="text-emerald-500" />
                  : <TrendingDown size={24} className="text-rose-500" />
                }
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground leading-tight">
                  {market.asset} will go{" "}
                  <span className={isUp ? "text-emerald-500" : "text-rose-500"}>
                    {isUp ? "UP ↑" : "DOWN ↓"}
                  </span>
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Entry price: <span className="font-medium text-foreground">${formatPrice(market.entry_price)}</span>
                  {" · "}Target: {new Date(market.prediction_target_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>
          </div>

          {/* Confidence */}
          <div className="bg-card rounded-2xl ring-1 ring-foreground/10 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Zap size={14} className="text-primary" /> Agent Confidence
              </div>
              <span className={`text-2xl font-bold tabular-nums ${isUp ? "text-emerald-500" : "text-rose-500"}`}>
                {confidence}%
              </span>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${isUp ? "bg-emerald-500" : "bg-rose-500"}`}
                style={{ width: `${confidence}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              The agent's self-reported confidence in this prediction.
            </p>
          </div>

          {/* Pool breakdown */}
          <div className="bg-card rounded-2xl ring-1 ring-foreground/10 p-5 space-y-4">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Users size={14} className="text-primary" /> Betting Pool
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-emerald-600 font-semibold">Agree</span>
              <span className="text-rose-500 font-semibold">Disagree</span>
            </div>

            {/* Split bar */}
            <div className="h-4 rounded-full bg-rose-500/30 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500/80 transition-all duration-700"
                style={{ width: `${agreeRatio}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-sm">
              <div>
                <span className="font-bold text-foreground tabular-nums">
                  {parseFloat(market.total_agree_pool).toFixed(0)}
                </span>
                <span className="text-muted-foreground"> credits · {agreeRatio}%</span>
              </div>
              <div className="text-right">
                <span className="font-bold text-foreground tabular-nums">
                  {parseFloat(market.total_disagree_pool).toFixed(0)}
                </span>
                <span className="text-muted-foreground"> credits · {100 - agreeRatio}%</span>
              </div>
            </div>

            <div className="pt-1 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
              <span>Total pool</span>
              <span className="font-semibold text-foreground">{totalPool} credits</span>
            </div>
          </div>

          {/* Market info */}
          <div className="bg-card rounded-2xl ring-1 ring-foreground/10 p-5 space-y-3">
            <p className="text-sm font-semibold text-foreground">Market Info</p>
            <div className="space-y-2 text-xs">
              {[
                ["Market ID", `#${market.id}`],
                ["Status", market.status],
                ["Betting closes", new Date(market.betting_closes_at).toLocaleString()],
                ["Resolves at", new Date(market.resolution_time).toLocaleString()],
                ["Outcome", market.outcome === "pending" ? "Pending" : market.outcome],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium text-foreground capitalize">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right: bet panel (2/5) — sticky on desktop ── */}
        <div className="lg:col-span-2 lg:sticky lg:top-6">
          <BetPanel market={market} onSuccess={load} />
        </div>

      </div>
    </div>
  )
}

// ── Live countdown component (re-renders every second) ─────────────────────────

function LiveCountdown({ target }: { target: string }) {
  const timeLeft = useCountdown(target)
  const isClosed = timeLeft === "Closed"
  return (
    <div className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-full ${
      isClosed ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
    }`}>
      <Clock size={11} />
      <span>{timeLeft}</span>
    </div>
  )
}