"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { marketsApi } from "@/lib/api/markets"
import { MarketResponse } from "@/types/api"
import WalletConnect from "@/components/layout/WalletConnect"
import { getMarketOnChain } from "@/lib/stacks"
import type { OnChainMarket } from "@/lib/stacks"
import { TrendingUp, TrendingDown, Clock, Bot, Users, Zap } from "lucide-react"

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

function microToStx(micro: number): string {
  return (micro / 1_000_000).toFixed(0)
}

// ── Market Card ────────────────────────────────────────────────────────────────

function MarketCard({ market, onchainData }: { market: MarketResponse; onchainData: OnChainMarket | null }) {
  const countdown = useCountdown(market.betting_closes_at)
  const isUp = market.direction === "up"
  const isClosed = market.status !== "open" || countdown === "Closed"
  const confidence = Math.round(market.confidence * 100)

  const agreePool = onchainData?.agreePool ?? 0
  const disagreePool = onchainData?.disagreePool ?? 0
  const agreeRatio = poolRatio(agreePool, disagreePool)
  const totalStx = microToStx(agreePool + disagreePool)

  return (
    <Link href={`/markets/${market.id}`}>
      <div className="bg-card rounded-2xl ring-1 ring-foreground/10 overflow-hidden hover:ring-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 cursor-pointer flex flex-col h-full">

        {/* Agent badge + timer */}
        <div className="px-4 pt-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Bot size={12} className="text-primary" />
            </div>
            <span className="text-xs font-semibold text-primary truncate">
              {market.agent_name ?? "System Agent"}
            </span>
          </div>
          <div className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full shrink-0 ${
            isClosed ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
          }`}>
            <Clock size={10} />
            <span>{isClosed ? "Closed" : countdown}</span>
          </div>
        </div>

        {/* Headline prediction */}
        <div className="px-4 pt-2 pb-3">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
              isUp ? "bg-emerald-500/10" : "bg-rose-500/10"
            }`}>
              {isUp
                ? <TrendingUp size={16} className="text-emerald-500" />
                : <TrendingDown size={16} className="text-rose-500" />
              }
            </div>
            <div>
              <p className="text-sm font-bold text-foreground leading-tight">
                {market.asset} will go{" "}
                <span className={isUp ? "text-emerald-500" : "text-rose-500"}>
                  {isUp ? "UP ↑" : "DOWN ↓"}
                </span>
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                in {market.prediction_target_time
                  ? `${Math.max(0, Math.round((new Date(market.prediction_target_time).getTime() - Date.now()) / 60000))} min`
                  : "15 min"
                }
              </p>
            </div>
          </div>
        </div>

        {/* Confidence bar */}
        <div className="px-4 pb-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Zap size={10} className="text-primary" /> Confidence
            </span>
            <span className="font-semibold text-foreground">{confidence}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full ${isUp ? "bg-emerald-500" : "bg-rose-500"}`}
              style={{ width: `${confidence}%` }}
            />
          </div>
        </div>

        {/* Pool bar */}
        <div className="px-4 pb-4 space-y-1.5 mt-auto">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Users size={10} /> Pool</span>
            <span>{totalStx} STX · {agreeRatio}% agree</span>
          </div>
          <div className="h-1.5 rounded-full bg-rose-500/30 overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500/70"
              style={{ width: `${agreeRatio}%` }}
            />
          </div>
          <p className="text-xs text-primary font-medium text-right">
            Tap to bet →
          </p>
        </div>

      </div>
    </Link>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function MarketsPage() {
  const [markets, setMarkets] = useState<MarketResponse[]>([])
  const [onchainMap, setOnchainMap] = useState<Record<number, OnChainMarket>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await marketsApi.getMarkets()
      setMarkets(data)

      // Fetch on-chain data for markets that have an onchain_market_id
      const onchainPromises = data
        .filter((m) => m.onchain_market_id)
        .map(async (m) => {
          const onchain = await getMarketOnChain(m.onchain_market_id!)
          return { dbId: m.id, onchain }
        })

      const results = await Promise.all(onchainPromises)
      const map: Record<number, OnChainMarket> = {}
      for (const r of results) {
        if (r.onchain) map[r.dbId] = r.onchain
      }
      setOnchainMap(map)
    } catch {
      setError("Failed to load markets.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Poll on-chain data every 20s
  useEffect(() => {
    const id = setInterval(() => {
      const onchainMarkets = markets.filter((m) => m.onchain_market_id)
      if (onchainMarkets.length === 0) return

      Promise.all(
        onchainMarkets.map(async (m) => {
          const onchain = await getMarketOnChain(m.onchain_market_id!)
          return { dbId: m.id, onchain }
        })
      ).then((results) => {
        const map: Record<number, OnChainMarket> = {}
        for (const r of results) {
          if (r.onchain) map[r.dbId] = r.onchain
        }
        setOnchainMap(map)
      })
    }, 20000)
    return () => clearInterval(id)
  }, [markets])

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
      <div className="flex items-center justify-between pt-2 pb-2">
        <div>
          <h1 className="text-2xl font-bold">Markets</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {markets.length} open market{markets.length !== 1 ? "s" : ""}
          </p>
        </div>
        <WalletConnect />
      </div>

      {markets.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          No open markets right now. Check back soon.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {markets.map((market) => (
            <MarketCard
              key={market.id}
              market={market}
              onchainData={onchainMap[market.id] ?? null}
            />
          ))}
        </div>
      )}
    </div>
  )
}