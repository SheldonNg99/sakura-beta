"use client"

import { useEffect } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "sonner"
import { useAuthStore } from "@/lib/store/auth"
import { authApi } from "@/lib/api/auth"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({ subsets: ["latin"] })

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
})

// ── Session initializer — runs once on app load ────────────────────────────────

function SessionInitializer({ children }: { children: React.ReactNode }) {
  const { setAuth, setInitialized } = useAuthStore()

  useEffect(() => {
    const initSession = async () => {
      try {
        // Attempt to restore session from HttpOnly refresh cookie
        const { access_token } = await authApi.refresh()
        const user = await authApi.me()
        setAuth(access_token, user)
      } catch {
        // No valid session — user will be redirected by the auth guard
      } finally {
        setInitialized()
      }
    }

    initSession()
  }, [setAuth, setInitialized])

  return <>{children}</>
}

// ── Root layout ────────────────────────────────────────────────────────────────

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <QueryClientProvider client={queryClient}>
          <SessionInitializer>
            {children}
          </SessionInitializer>
          {/* Toaster for all API error/success notifications */}
          <Toaster
            position="top-center"
            duration={4000}
            toastOptions={{
              style: {
                background: "#111827",
                color: "#FFFFFF",
                border: "none",
                borderRadius: "12px",
                fontSize: "14px",
              },
            }}
          />
        </QueryClientProvider>
      </body>
    </html>
  )
}