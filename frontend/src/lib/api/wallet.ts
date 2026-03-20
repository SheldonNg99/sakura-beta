import { api } from "@/lib/api/axios"
import { WalletBalanceResponse, WalletConnectResponse, WalletHistoryResponse } from "@/types/api"

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

  connectWallet: async (stacks_address: string): Promise<WalletConnectResponse> => {
    const { data } = await api.post<WalletConnectResponse>("/wallet/connect", { stacks_address })
    return data
  },

  disconnectWallet: async (): Promise<void> => {
    await api.delete("/wallet/connect")
  },
}