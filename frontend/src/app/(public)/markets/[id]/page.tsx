"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { marketsApi } from "@/lib/api/markets"
import { api } from "@/lib/api/axios"
import { useAuthStore } from "@/lib/store/auth"
import { MarketResponse, BetPosition } from "@/types/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  placeBetOnChain,
  createMarketOnChain,
  claimPayoutOnChain,
  getWalletAddress,
  isWalletConnected,
  getMarketOnChain,
  SAKURA_CONTRACT_ADDRESS,
  SAKURA_CONTRACT_NAME,
} from "@/lib/stacks"
import type { OnChainMarket } from "@/lib/stacks"
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
  Wallet,
  Link as LinkIcon,
  Gift,
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

function poolRatio(agree: number, disagree: number): number {
  const total = agree + disagree
  if (total === 0) return 50
  return Math.round((agree / total) * 100)
}

function calcOdds(agree: number, disagree: number, side: BetPosition): string {
  const total = agree + disagree
  if (total === 0) return "2.00"
  const pool = side === "agree" ? agree : disagree
  if (pool === 0) return "∞"
  return (total / pool).toFixed(2)
}

function formatPrice(p: string): string {
  return parseFloat(p).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function microToStx(micro: number): string {
  return (micro / 1_000_000).toFixed(2)
}

// ── Poll for tx confirmation ───────────────────────────────────────────────────

async function waitForTx(txId: string, maxAttempts = 20): Promise<number | null> {
  const STACKS_API = "https://api.testnet.hiro.so"
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 6000))
    try {
      const resp = await fetch(`${STACKS_API}/extended/v1/tx/${txId}`)
      const data = await resp.json()
      if (data.tx_status === "success") {
        const countResp = await fetch(
          `${STACKS_API}/v2/contracts/call-read/${SAKURA_CONTRACT_ADDRESS}/${SAKURA_CONTRACT_NAME}/get-market-count`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sender: SAKURA_CONTRACT_ADDRESS, arguments: [] }),
          }
        )
        const countData = await countResp.json()
        if (countData.okay) {
          const hex = countData.result.slice(2)
          return parseInt(hex.slice(-32), 16)
        }
      } else if (data.tx_status?.startsWith("abort")) {
        return null
      }
    } catch { /* keep polling */ }
  }
  return null
}

// ── Create On-Chain Panel ──────────────────────────────────────────────────────

function CreateOnChainPanel({ market, onSynced }: { market: MarketResponse; onSynced: () => void }) {
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!isWalletConnected()) {
      toast.error("Connect your Leather wallet first")
      return
    }
    setIsLoading(true)
    setStatus("Opening Leather wallet...")

    createMarketOnChain(
      market.agent_id ?? 0,
      market.asset,
      market.direction,
      parseFloat(market.entry_price),
      market.prediction_id,
      market.confidence,
      async (txId) => {
        setStatus("TX broadcasted! Waiting for confirmation (~30s)...")
        toast.success(`TX: ${txId.slice(0, 10)}... — waiting for confirmation`)
        const onchainId = await waitForTx(txId)
        if (onchainId) {
          try {
            await api.post(`/markets/${market.id}/sync-onchain`, {
              onchain_market_id: onchainId,
              tx_id: txId,
            })
          } catch { /* best effort */ }
          toast.success(`Market synced! On-chain ID: ${onchainId}`)
          setIsLoading(false)
          setStatus(null)
          onSynced()
        } else {
          toast.error("TX failed or timed out")
          setIsLoading(false)
          setStatus(null)
        }
      },
      () => {
        setIsLoading(false)
        setStatus(null)
        toast.error("Cancelled")
      },
    )
  }

  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5 space-y-3">
      <div className="flex items-center gap-2">
        <LinkIcon size={16} className="text-amber-500" />
        <p className="text-sm font-semibold text-amber-600">Not on-chain yet</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Register this market on-chain before placing STX bets.
      </p>
      {status && (
        <p className="text-xs text-amber-600 flex items-center gap-1.5">
          <Loader2 size={11} className="animate-spin" /> {status}
        </p>
      )}
      <Button
        onClick={handleCreate}
        disabled={isLoading}
        size="sm"
        className="w-full bg-amber-500 hover:bg-amber-600 text-white"
      >
        {isLoading ? (
          <span className="flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Processing...</span>
        ) : "Register Market On-Chain"}
      </Button>
    </div>
  )
}

// ── Claim Payout Panel ─────────────────────────────────────────────────────────

function ClaimPayoutPanel({ market }: { market: MarketResponse }) {
  const [isLoading, setIsLoading] = useState(false)
  const [claimed, setClaimed] = useState(false)

  if (!market.onchain_market_id) return null
  if (market.status !== "resolved") return null

  const handleClaim = async () => {
    if (!isWalletConnected()) {
      toast.error("Connect your Leather wallet first")
      return
    }

    setIsLoading(true)

    // Try claiming nonces 0 through 9 (user may have multiple bets)
    // The contract will reject with ERR-WRONG-SIDE or ERR-ALREADY-CLAIMED for invalid ones
    // and succeed for valid unclaimed winning bets
    let claimed = false
    for (let nonce = 0; nonce < 10; nonce++) {
      try {
        await new Promise<void>((resolve, reject) => {
          claimPayoutOnChain(
            market.onchain_market_id!,
            nonce,
            (txId) => {
              toast.success(`Payout claimed! TX: ${txId.slice(0, 10)}...`)
              claimed = true
              resolve()
            },
            () => {
              // User cancelled or error — stop trying
              reject(new Error("cancelled"))
            },
          )
        })
        // If we got here, one claim succeeded — break
        break
      } catch {
        // cancelled by user — stop
        break
      }
    }

    setIsLoading(false)
    if (claimed) setClaimed(true)
  }

  if (claimed) {
    return (
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-5 text-center space-y-2">
        <Gift size={24} className="text-emerald-500 mx-auto" />
        <p className="text-sm font-semibold text-emerald-600">Payout Claimed!</p>
        <p className="text-xs text-muted-foreground">Check your wallet for the STX payout.</p>
      </div>
    )
  }

  return (
    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Gift size={16} className="text-emerald-500" />
        <p className="text-sm font-semibold text-emerald-600">Market Resolved</p>
      </div>
      <p className="text-xs text-muted-foreground">
        If you placed a winning bet, claim your STX payout below.
      </p>
      <Button
        onClick={handleClaim}
        disabled={isLoading}
        size="sm"
        className="w-full bg-emerald-500 hover:bg-emerald-600 text-white"
      >
        {isLoading ? (
          <span className="flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Claiming...</span>
        ) : "Claim Payout"}
      </Button>
    </div>
  )
}

// ── Bet Panel ──────────────────────────────────────────────────────────────────

function BetPanel({
  market,
  onchainData,
  onSuccess,
}: {
  market: MarketResponse
  onchainData: OnChainMarket | null
  onSuccess: () => void
}) {
  const router = useRouter()
  const { isAuthenticated } = useAuthStore()
  const [side, setSide] = useState<BetPosition>("agree")
  const [amount, setAmount] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isClosed = market.status !== "open"
  const agreePool = onchainData?.agreePool ?? 0
  const disagreePool = onchainData?.disagreePool ?? 0
  const agreeOdds = calcOdds(agreePool, disagreePool, "agree")
  const disagreeOdds = calcOdds(agreePool, disagreePool, "disagree")
  const currentOdds = side === "agree" ? agreeOdds : disagreeOdds
  const potentialPayout = currentOdds !== "∞" && amount
    ? (parseFloat(amount) * parseFloat(currentOdds)).toFixed(2)
    : null
  const QUICK = [1, 2, 3, 5]

  const handleBet = async () => {
    if (!isAuthenticated) { router.push("/login"); return }
    if (!isWalletConnected()) { setError("Connect your Leather wallet to bet with STX"); return }
    if (!market.onchain_market_id) { setError("Register the market on-chain first."); return }
    const parsed = parseFloat(amount)
    if (!amount || isNaN(parsed) || parsed < 1) { setError("Minimum bet is 1 STX"); return }
    const senderAddress = getWalletAddress()
    if (!senderAddress) { setError("Wallet address not found. Reconnect Leather."); return }

    const amountMicro = Math.round(parsed * 1_000_000)
    setIsLoading(true)
    setError(null)

    placeBetOnChain(
      market.onchain_market_id,
      side === "agree",
      amountMicro,
      senderAddress,
      (txId: string) => {
        toast.success(`Bet placed! TX: ${txId.slice(0, 10)}...`)
        setAmount("")
        setIsLoading(false)
        setTimeout(onSuccess, 8000)
      },
      () => { setIsLoading(false); toast.error("Bet cancelled.") },
    )
  }

  if (isClosed) {
    return (
      <div className="bg-card rounded-2xl ring-1 ring-foreground/10 p-5 text-center space-y-2">
        <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center mx-auto">
          <Clock size={18} className="text-muted-foreground" />
        </div>
        <p className="text-sm font-semibold text-foreground">Betting Closed</p>
        <p className="text-xs text-muted-foreground">
          {market.status === "resolved" ? `Market resolved — ${market.outcome}` : "Awaiting resolution"}
        </p>
      </div>
    )
  }

  return (
    <div className="bg-card rounded-2xl ring-1 ring-foreground/10 overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <p className="text-sm font-semibold text-foreground">Place Your Bet</p>
        <p className="text-xs text-muted-foreground mt-0.5">Do you think the agent is right?</p>
      </div>
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {(["agree", "disagree"] as BetPosition[]).map((s) => (
            <button key={s} onClick={() => setSide(s)}
              className={`flex flex-col items-center py-3 rounded-xl border-2 transition-all ${
                side === s
                  ? s === "agree" ? "border-emerald-500 bg-emerald-500/10" : "border-rose-500 bg-rose-500/10"
                  : "border-border hover:border-primary/40"
              }`}
            >
              {s === "agree"
                ? <CheckCircle2 size={18} className={side === "agree" ? "text-emerald-500" : "text-muted-foreground"} />
                : <XCircle size={18} className={side === "disagree" ? "text-rose-500" : "text-muted-foreground"} />
              }
              <span className={`text-sm font-bold mt-1 capitalize ${
                side === s ? s === "agree" ? "text-emerald-600" : "text-rose-500" : "text-muted-foreground"
              }`}>{s}</span>
              <span className="text-xs mt-0.5 text-muted-foreground/60">
                {s === "agree" ? agreeOdds : disagreeOdds}x payout
              </span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {QUICK.map((q) => (
            <button key={q} onClick={() => setAmount(String(q))}
              className={`py-1.5 rounded-lg text-xs font-medium border transition-all ${
                amount === String(q) ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-primary/50"
              }`}
            >{q}</button>
          ))}
        </div>

        <div className="space-y-1">
          <Input type="number" placeholder="Enter amount (STX)" value={amount}
            onChange={(e) => { setAmount(e.target.value); setError(null) }}
            className="h-11 text-base" min="1"
          />
          {error && <p className="text-xs text-destructive pl-1">{error}</p>}
          {potentialPayout && !error && (
            <p className="text-xs text-muted-foreground pl-1">
              Est. payout: <span className="text-emerald-500 font-semibold">{potentialPayout} STX</span>
            </p>
          )}
        </div>

        <Button onClick={handleBet} disabled={isLoading || !market.onchain_market_id}
          className={`w-full h-11 font-semibold text-white ${side === "agree" ? "bg-emerald-500 hover:bg-emerald-600" : "bg-rose-500 hover:bg-rose-600"}`}
        >
          {isLoading
            ? <span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Placing bet...</span>
            : `${side === "agree" ? "Agree" : "Disagree"} · ${amount || "0"} STX`
          }
        </Button>

        {!isAuthenticated && (
          <p className="text-xs text-center text-muted-foreground">
            <a href="/login" className="text-primary font-medium">Sign in</a>{" "}and connect Leather wallet to bet
          </p>
        )}
        {isAuthenticated && !isWalletConnected() && (
          <p className="text-xs text-center text-amber-600 flex items-center justify-center gap-1">
            <Wallet size={11} /> Connect Leather wallet to bet
          </p>
        )}
      </div>
    </div>
  )
}

// ── Live Countdown ─────────────────────────────────────────────────────────────

function LiveCountdown({ target }: { target: string }) {
  const timeLeft = useCountdown(target)
  const isClosed = timeLeft === "Closed"
  return (
    <div className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-full ${isClosed ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>
      <Clock size={11} /><span>{timeLeft}</span>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function MarketDetailPage() {
  const params = useParams()
  const router = useRouter()
  const marketId = Number(params.id)
  const [market, setMarket] = useState<MarketResponse | null>(null)
  const [onchainData, setOnchainData] = useState<OnChainMarket | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadOnchainData = useCallback(async (onchainId: number) => {
    const data = await getMarketOnChain(onchainId)
    if (data) setOnchainData(data)
  }, [])

  const load = useCallback(async () => {
    try {
      const data = await marketsApi.getMarket(marketId)
      setMarket(data)
      if (data.onchain_market_id) {
        loadOnchainData(data.onchain_market_id)
      }
    } catch {
      setError("Market not found.")
    } finally {
      setLoading(false)
    }
  }, [marketId, loadOnchainData])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!market?.onchain_market_id) return
    const id = setInterval(() => loadOnchainData(market.onchain_market_id!), 15000)
    return () => clearInterval(id)
  }, [market?.onchain_market_id, loadOnchainData])

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
        <button onClick={() => router.back()} className="text-primary text-sm font-medium">← Back to markets</button>
      </div>
    )
  }

  const isUp = market.direction === "up"
  const confidence = Math.round(market.confidence * 100)

  const agreePoolMicro = onchainData?.agreePool ?? 0
  const disagreePoolMicro = onchainData?.disagreePool ?? 0
  const agreeStx = microToStx(agreePoolMicro)
  const disagreeStx = microToStx(disagreePoolMicro)
  const totalStx = microToStx(agreePoolMicro + disagreePoolMicro)
  const agreeRatio = poolRatio(agreePoolMicro, disagreePoolMicro)

  return (
    <div className="pt-6 pb-12 max-w-4xl">
      <button onClick={() => router.push("/markets")}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-5"
      >
        <ArrowLeft size={15} /> All markets
      </button>

      <div className="lg:grid lg:grid-cols-5 lg:gap-6 space-y-4 lg:space-y-0 lg:items-start">
        <div className="lg:col-span-3 space-y-4">

          <div className="bg-card rounded-2xl ring-1 ring-foreground/10 p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                <Bot size={15} className="text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Agent</p>
                <p className="text-sm font-bold text-primary">{market.agent_name ?? "System Agent"}</p>
              </div>
              <div className="ml-auto">
                {market.status === "open"
                  ? <LiveCountdown target={market.betting_closes_at} />
                  : <span className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded-full font-medium">{market.status}</span>
                }
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${isUp ? "bg-emerald-500/10" : "bg-rose-500/10"}`}>
                {isUp ? <TrendingUp size={24} className="text-emerald-500" /> : <TrendingDown size={24} className="text-rose-500" />}
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground leading-tight">
                  {market.asset} will go{" "}
                  <span className={isUp ? "text-emerald-500" : "text-rose-500"}>{isUp ? "UP ↑" : "DOWN ↓"}</span>
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Entry: <span className="font-medium text-foreground">${formatPrice(market.entry_price)}</span>
                  {" · "}Target: {new Date(market.prediction_target_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-2xl ring-1 ring-foreground/10 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Zap size={14} className="text-primary" /> Agent Confidence
              </div>
              <span className={`text-2xl font-bold tabular-nums ${isUp ? "text-emerald-500" : "text-rose-500"}`}>{confidence}%</span>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-700 ${isUp ? "bg-emerald-500" : "bg-rose-500"}`} style={{ width: `${confidence}%` }} />
            </div>
          </div>

          <div className="bg-card rounded-2xl ring-1 ring-foreground/10 p-5 space-y-4">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Users size={14} className="text-primary" /> Betting Pool {onchainData && <span className="text-xs font-normal text-emerald-500">(live on-chain)</span>}
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-emerald-600 font-semibold">Agree</span>
              <span className="text-rose-500 font-semibold">Disagree</span>
            </div>
            <div className="h-4 rounded-full bg-rose-500/30 overflow-hidden">
              <div className="h-full rounded-full bg-emerald-500/80 transition-all duration-700" style={{ width: `${agreeRatio}%` }} />
            </div>
            <div className="flex items-center justify-between text-sm">
              <div>
                <span className="font-bold text-foreground tabular-nums">{agreeStx}</span>
                <span className="text-muted-foreground"> STX · {agreeRatio}%</span>
              </div>
              <div className="text-right">
                <span className="font-bold text-foreground tabular-nums">{disagreeStx}</span>
                <span className="text-muted-foreground"> STX · {100 - agreeRatio}%</span>
              </div>
            </div>
            <div className="pt-1 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
              <span>Total pool</span>
              <span className="font-semibold text-foreground">{totalStx} STX</span>
            </div>
          </div>

          <div className="bg-card rounded-2xl ring-1 ring-foreground/10 p-5 space-y-3">
            <p className="text-sm font-semibold text-foreground">Market Info</p>
            <div className="space-y-2 text-xs">
              {([
                ["Market ID", `#${market.id}`],
                ["On-chain ID", market.onchain_market_id ? `#${market.onchain_market_id}` : "Not registered"],
                ["Status", market.status],
                ["Betting closes", new Date(market.betting_closes_at).toLocaleString()],
                ["Resolves at", new Date(market.resolution_time).toLocaleString()],
                ["Outcome", market.outcome === "pending" ? "Pending" : market.outcome],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{label}</span>
                  <span className={`font-medium capitalize ${label === "On-chain ID" && !market.onchain_market_id ? "text-amber-500" : "text-foreground"}`}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 lg:sticky lg:top-6 space-y-3">
          {market.status === "resolved" && market.onchain_market_id && (
            <ClaimPayoutPanel market={market} />
          )}

          <BetPanel market={market} onchainData={onchainData} onSuccess={() => {
            if (market.onchain_market_id) loadOnchainData(market.onchain_market_id)
          }} />
        </div>
      </div>
    </div>
  )
}