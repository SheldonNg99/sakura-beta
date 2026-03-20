"use client"

import { useState, useEffect } from "react"
import { Wallet, LogOut } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  connectWallet,
  disconnectWallet,
  getWalletAddress,
  isWalletConnected,
} from "@/lib/stacks"

export default function WalletConnect() {
  const [address, setAddress] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (isWalletConnected()) {
      setAddress(getWalletAddress())
    }
  }, [])

  const handleConnect = async () => {
    setLoading(true)
    await connectWallet(
      (addr) => {
        setAddress(addr)
        setLoading(false)
        toast.success("Wallet connected!")
      },
      (err) => {
        setLoading(false)
        if (!err.message.toLowerCase().includes("cancel")) {
          toast.error(err.message || "Failed to connect wallet")
        }
      },
    )
  }

  const handleDisconnect = async () => {
    await disconnectWallet(() => {
      setAddress(null)
      toast.success("Wallet disconnected")
    })
  }

  const shortAddress = (addr: string) =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`

  if (address) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2.5 py-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-medium text-emerald-600">
            {shortAddress(address)}
          </span>
        </div>
        <button
          onClick={handleDisconnect}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Disconnect wallet"
        >
          <LogOut size={14} />
        </button>
      </div>
    )
  }

  return (
    <Button
      onClick={handleConnect}
      disabled={loading}
      size="sm"
      className="gap-1.5 text-xs h-8"
    >
      <Wallet size={14} />
      {loading ? "Connecting..." : "Connect Wallet"}
    </Button>
  )
}