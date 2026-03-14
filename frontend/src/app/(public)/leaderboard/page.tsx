"use client"

import { useEffect, useState } from "react"
import { leaderboardApi } from "@/lib/api/leaderboard"
import { LeaderboardResponse, TopTraderEntry } from "@/types/api"
import { Bot, Trophy, Medal } from "lucide-react"

// ── Helpers ────────────────────────────────────────────────────────────────────

function maskEmail(email: string): string {
  const [user, domain] = email.split("@")
  return user.slice(0, 2) + "***@" + domain
}

function getRankStyle(rank: number): { bg: string; text: string; icon: React.ReactNode } {
  if (rank === 1) return { bg: "bg-amber-400/15", text: "text-amber-500", icon: <Medal size={14} className="text-amber-500" /> }
  if (rank === 2) return { bg: "bg-slate-400/15", text: "text-slate-400", icon: <Medal size={14} className="text-slate-400" /> }
  if (rank === 3) return { bg: "bg-orange-600/15", text: "text-orange-500", icon: <Medal size={14} className="text-orange-500" /> }
  return { bg: "bg-muted", text: "text-muted-foreground", icon: null }
}

// ── AI Accuracy Card ───────────────────────────────────────────────────────────

function AIAccuracyCard({ data }: { data: LeaderboardResponse["ai_accuracy"] }) {
  const accuracyColor =
    data.accuracy_pct >= 60 ? "text-emerald-500" :
    data.accuracy_pct >= 40 ? "text-amber-500" :
    "text-rose-500"

  const barColor =
    data.accuracy_pct >= 60 ? "bg-emerald-500" :
    data.accuracy_pct >= 40 ? "bg-amber-500" :
    "bg-rose-500"

  return (
    <div className="bg-card rounded-2xl ring-1 ring-foreground/10 p-4 h-full">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
          <Bot size={16} className="text-primary" />
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground">AI Performance</div>
          <div className="text-xs text-muted-foreground">All-time prediction accuracy</div>
        </div>
        <div className={`ml-auto text-2xl font-bold tabular-nums ${accuracyColor}`}>
          {data.accuracy_pct.toFixed(1)}%
        </div>
      </div>

      <div className="h-2 bg-muted rounded-full overflow-hidden mb-4">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor}`}
          style={{ width: `${data.accuracy_pct}%` }}
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-emerald-500/10 rounded-xl px-3 py-2 text-center">
          <div className="text-base font-bold text-emerald-500 tabular-nums">{data.correct}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Correct</div>
        </div>
        <div className="bg-rose-500/10 rounded-xl px-3 py-2 text-center">
          <div className="text-base font-bold text-rose-500 tabular-nums">{data.incorrect}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Incorrect</div>
        </div>
        <div className="bg-muted rounded-xl px-3 py-2 text-center">
          <div className="text-base font-bold text-foreground tabular-nums">{data.pending}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Pending</div>
        </div>
      </div>
    </div>
  )
}

// ── Trader Row ─────────────────────────────────────────────────────────────────

function TraderRow({ trader }: { trader: TopTraderEntry }) {
  const { bg, text, icon } = getRankStyle(trader.rank)

  return (
    <div className="flex items-center gap-3 py-3 border-b border-border last:border-0">
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-xs font-bold ${bg} ${text}`}>
        {icon ?? <span>#{trader.rank}</span>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground truncate">{maskEmail(trader.email)}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {trader.total_bets} bets · {trader.win_rate_pct.toFixed(1)}% win rate
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-semibold text-emerald-500 tabular-nums">
          +{parseFloat(trader.total_winnings).toLocaleString(undefined, { minimumFractionDigits: 0 })}
        </div>
        <div className="text-xs text-muted-foreground">credits</div>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function LeaderboardPage() {
  const [data, setData] = useState<LeaderboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    leaderboardApi.getLeaderboard()
      .then(setData)
      .catch(() => setError("Failed to load leaderboard."))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="pt-8 space-y-4">
        <div className="lg:grid lg:grid-cols-2 lg:gap-6 space-y-4 lg:space-y-0">
          <div className="bg-card rounded-2xl ring-1 ring-foreground/10 h-44 animate-pulse" />
          <div className="bg-card rounded-2xl ring-1 ring-foreground/10 h-64 animate-pulse" />
        </div>
      </div>
    )
  }

  if (error) return <div className="pt-8 text-center text-muted-foreground text-sm">{error}</div>

  return (
    <div className="pt-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Leaderboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">AI vs humans. Who&apos;s winning?</p>
      </div>

      {/* ── Desktop: side-by-side. Mobile: stacked ── */}
      <div className="lg:grid lg:grid-cols-2 lg:gap-6 space-y-4 lg:space-y-0 lg:items-start">

        {/* AI accuracy */}
        {data && <AIAccuracyCard data={data.ai_accuracy} />}

        {/* Top traders */}
        <div className="bg-card rounded-2xl ring-1 ring-foreground/10 overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Trophy size={14} className="text-amber-500" />
            <h2 className="text-sm font-semibold text-foreground">Top Traders</h2>
          </div>
          {!data || data.top_traders.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No traders yet. Be the first to bet!
            </div>
          ) : (
            <div className="px-4">
              {data.top_traders.map((trader) => (
                <TraderRow key={trader.user_id} trader={trader} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}