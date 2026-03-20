import axios, { AxiosError, InternalAxiosRequestConfig } from "axios"
import { useAuthStore } from "@/lib/store/auth"

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

// ── Axios instance ─────────────────────────────────────────────────────────────

export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,  // sends HttpOnly refresh cookie on every request
  headers: {
    "Content-Type": "application/json",
  },
})

// ── Request interceptor — attach access token ──────────────────────────────────

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ── Response interceptor — silent token refresh on 401 ────────────────────────

let isRefreshing = false
let failedQueue: Array<{
  resolve: (token: string) => void
  reject: (error: unknown) => void
}> = []

const processQueue = (error: unknown, token: string | null) => {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error)
    else resolve(token!)
  })
  failedQueue = []
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }

    // Only attempt refresh on 401, and not on the refresh/login endpoints themselves
    const isAuthEndpoint =
      originalRequest.url?.includes("/auth/refresh") ||
      originalRequest.url?.includes("/auth/login")

    if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint) {
      if (isRefreshing) {
        // Queue subsequent 401s while a refresh is in flight
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`
          return api(originalRequest)
        })
      }

      originalRequest._retry = true
      isRefreshing = true

      try {
        // Attempt silent refresh — cookie is sent automatically
        const { data } = await axios.post(
          `${BASE_URL}/auth/refresh`,
          {},
          { withCredentials: true }
        )

        const newToken = data.access_token

        // Fetch updated user info
        const { data: user } = await axios.get(`${BASE_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${newToken}` },
          withCredentials: true,
        })

        useAuthStore.getState().setAuth(newToken, user)
        processQueue(null, newToken)

        originalRequest.headers.Authorization = `Bearer ${newToken}`
        return api(originalRequest)
      } catch (refreshError) {
        processQueue(refreshError, null)
        useAuthStore.getState().clearAuth()

        // Only redirect to login if we're currently on a protected page
        if (typeof window !== "undefined") {
          const publicPaths = ["/markets", "/leaderboard"]
          const isPublicPage = publicPaths.some(p => window.location.pathname.startsWith(p))
          if (!isPublicPage) {
            window.location.href = "/login"
          }
        }
        return Promise.reject(refreshError)
      }finally {
        isRefreshing = false
      }
    }

    return Promise.reject(error)
  }
)