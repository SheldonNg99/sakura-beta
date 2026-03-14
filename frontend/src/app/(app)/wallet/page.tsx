"use client"

import { useEffect, useState } from "react"
import { walletApi } from "@/lib/api/wallet"
import { WalletBalanceResponse, WalletTransactionResponse, TransactionType } from "@/types/api"
import { Wallet, ArrowUpRight, Gift, RotateCcw, TrendingUp } from "lucide-react"

// ── Config ─────────────────────────────────────────────────────────────────────

const TX_CONFIG: Record<TransactionType, { label: string; icon: React.ReactNode; color: string; bgColor: string }> = {
  starting_credit: { label: "Starting Credits", icon: <Gift size={15} />, color: "text-primary", bgColor: "bg-primary/10" },
  bet_debit:       { label: "Bet Placed",        icon: <ArrowUpRight size={15} />, color: "text-rose-500", bgColor: "bg-rose-500/10" },
  win_credit:      { label: "Winnings",           icon: <TrendingUp size={15} />, color: "text-emerald-500", bgColor: "bg-emerald-500/10" },
  refund:          { label: "Refund",             icon: <RotateCcw size={15} />, color: "text-amber-500", bgColor: "bg-amber-500/10" },
}

function formatAmount(amount: string): string {
  const n = parseFloat(amount)
  return (n >= 0 ? "+" : "") + n.toFixed(2)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

// ── Transaction Row ────────────────────────────────────────────────────────────

function TransactionRow({ tx }: { tx: WalletTransactionResponse }) {
  const config = TX_CONFIG[tx.type]
  const isPositive = parseFloat(tx.amount) >= 0
  return (
    <div className="flex items-center gap-3 py-3 border-b border-border last:border-0">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${config.bgColor} ${config.color}`}>
        {config.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground">{config.label}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{formatDate(tx.created_at)}</div>
      </div>
      <div className={`text-sm font-semibold tabular-nums shrink-0 ${isPositive ? "text-emerald-500" : "text-rose-500"}`}>
        {formatAmount(tx.amount)}
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function WalletPage() {
  const [balance, setBalance] = useState<WalletBalanceResponse | null>(null)
  const [transactions, setTransactions] = useState<WalletTransactionResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const [bal, history] = await Promise.all([walletApi.getBalance(), walletApi.getHistory()])
        setBalance(bal)
        setTransactions(history.transactions)
      } catch {
        setError("Failed to load wallet.")
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="pt-8 lg:grid lg:grid-cols-5 lg:gap-6 space-y-4 lg:space-y-0">
        <div className="lg:col-span-2 bg-card rounded-2xl ring-1 ring-foreground/10 h-44 animate-pulse" />
        <div className="lg:col-span-3 bg-card rounded-2xl ring-1 ring-foreground/10 h-64 animate-pulse" />
      </div>
    )
  }

  if (error) return <div className="pt-8 text-center text-muted-foreground text-sm">{error}</div>

  return (
    <div className="pt-6">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-foreground">Wallet</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Your credits and transaction history</p>
      </div>

      {/* ── Desktop: 2-col. Mobile: stacked ── */}
      <div className="lg:grid lg:grid-cols-5 lg:gap-6 lg:items-start space-y-4 lg:space-y-0">

        {/* Balance card — takes 2/5 on desktop */}
        <div className="lg:col-span-2">
          <div className="bg-primary rounded-2xl px-5 py-6">
            <div className="flex items-center gap-2 text-primary-foreground/70 text-sm mb-3">
              <Wallet size={14} />
              <span>Available Balance</span>
            </div>
            <div className="text-4xl font-bold text-primary-foreground tracking-tight">
              {parseFloat(balance?.balance ?? "0").toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
            <div className="text-primary-foreground/60 text-sm mt-1">credits</div>
          </div>

          {/* Quick stats on desktop */}
          <div className="hidden lg:grid grid-cols-2 gap-3 mt-4">
            <div className="bg-card rounded-xl ring-1 ring-foreground/10 px-4 py-3 text-center">
              <div className="text-lg font-bold text-emerald-500 tabular-nums">
                {transactions.filter(t => t.type === "win_credit").length}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">Wins</div>
            </div>
            <div className="bg-card rounded-xl ring-1 ring-foreground/10 px-4 py-3 text-center">
              <div className="text-lg font-bold text-foreground tabular-nums">
                {transactions.filter(t => t.type === "bet_debit").length}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">Bets placed</div>
            </div>
          </div>
        </div>

        {/* Transaction list — takes 3/5 on desktop */}
        <div className="lg:col-span-3 bg-card rounded-2xl ring-1 ring-foreground/10 overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Transaction History</h2>
            <span className="text-xs text-muted-foreground">{transactions.length} transactions</span>
          </div>
          {transactions.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">No transactions yet.</div>
          ) : (
            <div className="px-4 overflow-y-auto">
              {transactions.map((tx) => (
                <TransactionRow key={tx.id} tx={tx} />
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}