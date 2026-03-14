"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { walletApi } from "@/lib/api/wallet"
import { authApi } from "@/lib/api/auth"
import { useAuthStore } from "@/lib/store/auth"
import { WalletTransactionResponse } from "@/types/api"
import { LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"

// ── Helpers ────────────────────────────────────────────────────────────────────

function deriveStats(transactions: WalletTransactionResponse[]) {
  let totalBets = 0, totalWon = 0, wins = 0
  for (const tx of transactions) {
    if (tx.type === "bet_debit") totalBets++
    if (tx.type === "win_credit") { wins++; totalWon += parseFloat(tx.amount) }
  }
  const winRate = totalBets > 0 ? Math.round((wins / totalBets) * 100) : 0
  return { totalBets, totalWon, wins, winRate }
}

function getInitials(email: string): string {
  return email.slice(0, 2).toUpperCase()
}

// ── Reusable row ───────────────────────────────────────────────────────────────

function Row({
  label,
  value,
  valueClassName,
  action,
}: {
  label: string
  value?: React.ReactNode
  valueClassName?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-border last:border-0">
      <span className="text-sm text-foreground">{label}</span>
      <div className="flex items-center gap-3">
        {value && (
          <span className={`text-sm font-medium tabular-nums ${valueClassName ?? "text-muted-foreground"}`}>
            {value}
          </span>
        )}
        {action}
      </div>
    </div>
  )
}

// ── Section wrapper ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-2xl ring-1 ring-foreground/10 px-5 overflow-hidden">
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-4 pb-2">
        {title}
      </h2>
      {children}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const router = useRouter()
  const { user, clearAuth } = useAuthStore()
  const [balance, setBalance] = useState<string | null>(null)
  const [stats, setStats] = useState<ReturnType<typeof deriveStats> | null>(null)
  const [loading, setLoading] = useState(true)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const [bal, history] = await Promise.all([
          walletApi.getBalance(),
          walletApi.getHistory(100),
        ])
        setBalance(bal.balance)
        setStats(deriveStats(history.transactions))
      } catch {
        // non-critical — still show the page
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleLogout = async () => {
    setIsLoggingOut(true)
    try {
      await authApi.logout()
    } catch {
      // ignore — clear locally regardless
    } finally {
      clearAuth()
      toast.success("Logged out.")
      router.replace("/markets")
    }
  }

  const skeleton = <span className="inline-block w-16 h-4 bg-muted rounded animate-pulse" />

  return (
    <div className="pt-6 space-y-4 max-w-2xl">

      <h1 className="text-xl font-bold text-foreground">Profile</h1>

      {/* Avatar + email header */}
      <div className="flex items-center gap-4 bg-card rounded-2xl ring-1 ring-foreground/10 px-5 py-4">
        <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center shrink-0">
          <span className="text-primary-foreground font-bold text-base">
            {user ? getInitials(user.email) : "?"}
          </span>
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground">{user?.email ?? "—"}</div>
          <div className="text-xs text-muted-foreground mt-0.5">User #{user?.id}</div>
        </div>
      </div>

      {/* Account info */}
      <Section title="Account">
        <Row label="Email" value={user?.email ?? "—"} />
        <Row label="User ID" value={user ? `#${user.id}` : "—"} />
      </Section>

      {/* Wallet stats */}
      <Section title="Wallet">
        <Row
          label="Balance"
          value={loading ? skeleton : `${parseFloat(balance ?? "0").toLocaleString(undefined, { minimumFractionDigits: 2 })} credits`}
          valueClassName="text-primary font-bold"
        />
        <Row
          label="Total Bets"
          value={loading ? skeleton : String(stats?.totalBets ?? 0)}
        />
        <Row
          label="Wins"
          value={loading ? skeleton : `${stats?.wins ?? 0} of ${stats?.totalBets ?? 0}`}
        />
        <Row
          label="Win Rate"
          value={loading ? skeleton : `${stats?.winRate ?? 0}%`}
          valueClassName={(stats?.winRate ?? 0) >= 50 ? "text-emerald-500" : "text-muted-foreground"}
        />
        <Row
          label="Total Winnings"
          value={loading ? skeleton : `${(stats?.totalWon ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0 })} credits`}
          valueClassName="text-emerald-500"
        />
      </Section>

      {/* Session */}
      <Section title="Session">
        <Row
          label="Log out of this device"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="text-destructive border-destructive/30 hover:bg-destructive/5 hover:border-destructive/50"
            >
              {isLoggingOut
                ? <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 border-2 border-destructive border-t-transparent rounded-full animate-spin" />
                    Logging out...
                  </span>
                : <span className="flex items-center gap-1.5">
                    <LogOut size={13} />
                    Log out
                  </span>
              }
            </Button>
          }
        />
      </Section>

    </div>
  )
}