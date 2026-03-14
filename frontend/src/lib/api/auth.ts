import { api } from "@/lib/api/axios"
import {
  LoginRequest,
  RegisterRequest,
  TokenResponse,
  UserResponse,
} from "@/types/api"

export const authApi = {
  register: async (body: RegisterRequest): Promise<UserResponse> => {
    const { data } = await api.post<UserResponse>("/auth/register", body)
    return data
  },

  login: async (body: LoginRequest): Promise<TokenResponse> => {
    const { data } = await api.post<TokenResponse>("/auth/login", body)
    return data
  },

  // Called on app load to restore session from HttpOnly cookie
  refresh: async (): Promise<TokenResponse> => {
    const { data } = await api.post<TokenResponse>("/auth/refresh")
    return data
  },

  logout: async (): Promise<void> => {
    await api.post("/auth/logout")
  },

  me: async (): Promise<UserResponse> => {
    const { data } = await api.get<UserResponse>("/auth/me")
    return data
  },
}