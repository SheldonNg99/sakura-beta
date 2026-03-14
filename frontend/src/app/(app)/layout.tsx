"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/lib/store/auth"
import AppNav from "@/components/layout/AppNav"

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { isAuthenticated, isInitialized } = useAuthStore()

  useEffect(() => {
    if (!isInitialized) return
    if (!isAuthenticated) {
      router.replace("/login")
    }
  }, [isAuthenticated, isInitialized, router])

  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      {/* Mobile: pb-safe clears bottom nav. Desktop: ml-60 clears sidebar */}
      <main className="lg:ml-60 pb-20 lg:pb-0">
        <div className="max-w-5xl mx-auto px-4 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  )
}