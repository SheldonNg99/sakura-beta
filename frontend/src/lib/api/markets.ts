// frontend/src/lib/api/markets.ts
import { api } from "@/lib/api/axios"
import { BetResponse, MarketResponse, PlaceBetRequest } from "@/types/api"

export const marketsApi = {
  // List open markets — enriched with prediction + agent data
  getMarkets: async (limit = 20, offset = 0): Promise<MarketResponse[]> => {
    const { data } = await api.get<MarketResponse[]>("/markets", {
      params: { limit, offset },
    })
    return data
  },

  // Single market — same enriched shape
  getMarket: async (id: number): Promise<MarketResponse> => {
    const { data } = await api.get<MarketResponse>(`/markets/${id}`)
    return data
  },

  // Place a bet
  placeBet: async (marketId: number, body: PlaceBetRequest): Promise<BetResponse> => {
    const { data } = await api.post<BetResponse>(`/markets/${marketId}/bet`, body)
    return data
  },
}