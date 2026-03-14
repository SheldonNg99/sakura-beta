import { create } from "zustand"
import { UserResponse } from "@/types/api"

interface AuthState {
  // Access token lives in memory only — never localStorage
  accessToken: string | null
  user: UserResponse | null
  isAuthenticated: boolean
  isInitialized: boolean  // true once the initial /auth/refresh attempt has completed

  // Actions
  setAuth: (token: string, user: UserResponse) => void
  clearAuth: () => void
  setInitialized: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  isAuthenticated: false,
  isInitialized: false,

  setAuth: (token, user) =>
    set({
      accessToken: token,
      user,
      isAuthenticated: true,
    }),

  clearAuth: () =>
    set({
      accessToken: null,
      user: null,
      isAuthenticated: false,
    }),

  setInitialized: () => set({ isInitialized: true }),
}))