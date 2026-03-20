"use client"

import { useEffect, useState } from "react"
import { Wallet, ArrowUpRight, ExternalLink, Copy, Check } from "lucide-react"
import { getWalletAddress, isWalletConnected, SAKURA_CONTRACT_ADDRESS, SAKURA_CONTRACT_NAME } from "@/lib/stacks"
import dynamic from "next/dynamic"

const WalletConnect = dynamic(() => import("@/components/layout/WalletConnect"), { ssr: false })
const STACKS_API = "https://api.testnet.hiro.so"

interface StxBalance {
  balance: number      // micro-STX
  totalSent: number
  totalReceived: number
}

interface OnChainTx {
  txId: string
  type: string         // "place-bet" | "claim-payout" | "create-market"
  status: string
  amount: number       // micro-STX (from STX transfers)
  timestamp: string
}

function microToStx(micro: number): string {
  return (micro / 1_000_000).toFixed(2)
}

function shortenTxId(txId: string): string {
  return `${txId.slice(0, 8)}...${txId.slice(-6)}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

// ── Fetch STX balance from chain ───────────────────────────────────────────────

async function fetchStxBalance(address: string): Promise<StxBalance | null> {
  try {
    const resp = await fetch(`${STACKS_API}/extended/v1/address/${address}/balances`)
    const data = await resp.json()
    return {
      balance: parseInt(data.stx?.balance ?? "0"),
      totalSent: parseInt(data.stx?.total_sent ?? "0"),
      totalReceived: parseInt(data.stx?.total_received ?? "0"),
    }
  } catch {
    return null
  }
}

// ── Fetch on-chain transactions related to our contract ────────────────────────

async function fetchContractTxs(address: string): Promise<OnChainTx[]> {
  try {
    const resp = await fetch(
      `${STACKS_API}/extended/v1/address/${address}/transactions?limit=50`
    )
    const data = await resp.json()

    const contractId = `${SAKURA_CONTRACT_ADDRESS}.${SAKURA_CONTRACT_NAME}`

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txs: OnChainTx[] = (data.results ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((tx: any) => {
        if (tx.tx_type !== "contract_call") return false
        const id = tx.contract_call?.contract_id ?? ""
        return id === contractId
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((tx: any) => {
        const functionName = tx.contract_call?.function_name ?? "unknown"

        // Calculate STX amount from stx_transfers events
        let amount = 0
        if (tx.stx_transfers) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const t of tx.stx_transfers) {
            if (t.sender === address) amount -= parseInt(t.amount ?? "0")
            if (t.recipient === address) amount += parseInt(t.amount ?? "0")
          }
        }
        // Fallback: check fee + transfer events
        if (amount === 0 && tx.fee_rate) {
          // For place-bet, the amount is in the function args
          if (functionName === "place-bet" && tx.contract_call?.function_args?.[2]) {
            const arg = tx.contract_call.function_args[2]
            if (arg.repr) {
              const match = arg.repr.match(/u(\d+)/)
              if (match) amount = -parseInt(match[1])
            }
          }
        }

        return {
          txId: tx.tx_id,
          type: functionName,
          status: tx.tx_status,
          amount,
          timestamp: tx.burn_block_time_iso ?? tx.receipt_time_iso ?? "",
        }
      })

    return txs
  } catch {
    return []
  }
}

// ── Transaction Row ────────────────────────────────────────────────────────────

const TX_LABELS: Record<string, { label: string; color: string; bgColor: string }> = {
  "place-bet":      { label: "Bet Placed",      color: "text-rose-500",    bgColor: "bg-rose-500/10" },
  "claim-payout":   { label: "Payout Claimed",  color: "text-emerald-500", bgColor: "bg-emerald-500/10" },
  "create-market":  { label: "Market Created",  color: "text-primary",     bgColor: "bg-primary/10" },
}

function TxRow({ tx }: { tx: OnChainTx }) {
  const config = TX_LABELS[tx.type] ?? { label: tx.type, color: "text-muted-foreground", bgColor: "bg-muted" }
  const isPositive = tx.amount > 0
  const isNegative = tx.amount < 0
  const isPending = tx.status === "pending"

  return (
    <div className="flex items-center gap-3 py-3 border-b border-border last:border-0">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${config.bgColor} ${config.color}`}>
        <ArrowUpRight size={15} className={isPositive ? "rotate-180" : ""} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-foreground">{config.label}</span>
          {isPending && (
            <span className="text-[10px] bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded-full font-medium">pending</span>
          )}
        </div>
        <a
          href={`https://explorer.hiro.so/txid/${tx.txId}?chain=testnet`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 mt-0.5"
        >
          {shortenTxId(tx.txId)} <ExternalLink size={9} />
        </a>
      </div>
      <div className={`text-sm font-semibold tabular-nums shrink-0 ${
        isPositive ? "text-emerald-500" : isNegative ? "text-rose-500" : "text-muted-foreground"
      }`}>
        {tx.amount !== 0 ? `${isPositive ? "+" : ""}${microToStx(tx.amount)} STX` : "—"}
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function WalletPage() {
  const [address, setAddress] = useState<string | null>(null)
  const [stxBalance, setStxBalance] = useState<StxBalance | null>(null)
  const [txs, setTxs] = useState<OnChainTx[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const addr = getWalletAddress()
    setAddress(addr)

    if (!addr) {
      setLoading(false)
      return
    }

    const load = async () => {
      const [bal, transactions] = await Promise.all([
        fetchStxBalance(addr),
        fetchContractTxs(addr),
      ])
      setStxBalance(bal)
      setTxs(transactions)
      setLoading(false)
    }
    load()
  }, [])

  const handleCopy = () => {
    if (address) {
      navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // Not connected state
  if (!address || !isWalletConnected()) {
    return (
      <div className="pt-6">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-foreground">Wallet</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Connect your Leather wallet to view your balance</p>
        </div>
        <div className="bg-card rounded-2xl ring-1 ring-foreground/10 p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Wallet size={28} className="text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">No wallet connected</p>
            <p className="text-xs text-muted-foreground mt-1">Connect your Leather wallet to see your STX balance and transaction history.</p>
          </div>
          <WalletConnect />
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="pt-8 lg:grid lg:grid-cols-5 lg:gap-6 space-y-4 lg:space-y-0">
        <div className="lg:col-span-2 bg-card rounded-2xl ring-1 ring-foreground/10 h-44 animate-pulse" />
        <div className="lg:col-span-3 bg-card rounded-2xl ring-1 ring-foreground/10 h-64 animate-pulse" />
      </div>
    )
  }

  const betCount = txs.filter(t => t.type === "place-bet").length
  const claimCount = txs.filter(t => t.type === "claim-payout").length

  return (
    <div className="pt-6">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-foreground">Wallet</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Your on-chain STX balance and betting history</p>
      </div>

      <div className="lg:grid lg:grid-cols-5 lg:gap-6 lg:items-start space-y-4 lg:space-y-0">

        {/* Balance card */}
        <div className="lg:col-span-2">
          <div className="bg-primary rounded-2xl px-5 py-6">
            <div className="flex items-center gap-2 text-primary-foreground/70 text-sm mb-3">
              <Wallet size={14} />
              <span>STX Balance</span>
            </div>
            <div className="text-4xl font-bold text-primary-foreground tracking-tight">
              {microToStx(stxBalance?.balance ?? 0)}
            </div>
            <div className="text-primary-foreground/60 text-sm mt-1">STX (testnet)</div>

            {/* Address */}
            <div className="mt-4 flex items-center gap-2">
              <span className="text-xs text-primary-foreground/50 font-mono truncate">
                {address}
              </span>
              <button onClick={handleCopy} className="shrink-0 text-primary-foreground/50 hover:text-primary-foreground transition-colors">
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="bg-card rounded-xl ring-1 ring-foreground/10 px-4 py-3 text-center">
              <div className="text-lg font-bold text-foreground tabular-nums">
                {betCount}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">Bets Placed</div>
            </div>
            <div className="bg-card rounded-xl ring-1 ring-foreground/10 px-4 py-3 text-center">
              <div className="text-lg font-bold text-emerald-500 tabular-nums">
                {claimCount}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">Payouts Claimed</div>
            </div>
          </div>

          {/* Explorer link */}
          <a
            href={`https://explorer.hiro.so/address/${address}?chain=testnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            View on Stacks Explorer <ExternalLink size={10} />
          </a>
        </div>

        {/* Transaction list */}
        <div className="lg:col-span-3 bg-card rounded-2xl ring-1 ring-foreground/10 overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">SakuraBeta Transactions</h2>
            <span className="text-xs text-muted-foreground">{txs.length} on-chain</span>
          </div>
          {txs.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No SakuraBeta transactions yet. Place a bet to get started!
            </div>
          ) : (
            <div className="px-4 max-h-125 overflow-y-auto">
              {txs.map((tx) => (
                <TxRow key={tx.txId} tx={tx} />
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}