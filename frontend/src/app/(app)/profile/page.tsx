"use client"

import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { authApi } from "@/lib/api/auth"
import { useAuthStore } from "@/lib/store/auth"
import { LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useState } from "react"

// ── Helpers ────────────────────────────────────────────────────────────────────

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
  const [isLoggingOut, setIsLoggingOut] = useState(false)

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
        </div>
      </div>

      {/* Account info */}
      <Section title="Account">
        <Row label="Email" value={user?.email ?? "—"} />
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