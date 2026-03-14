import { api } from "@/lib/api/axios"
import { WalletBalanceResponse, WalletHistoryResponse } from "@/types/api"

export const walletApi = {
  getBalance: async (): Promise<WalletBalanceResponse> => {
    const { data } = await api.get<WalletBalanceResponse>("/wallet/balance")
    return data
  },

  getHistory: async (limit = 50, offset = 0): Promise<WalletHistoryResponse> => {
    const { data } = await api.get<WalletHistoryResponse>("/wallet/history", {
      params: { limit, offset },
    })
    return data
  },
}