import { api } from "@/lib/api/axios"
import {
  BetResponse,
  MarketResponse,
  PlaceBetRequest,
  PredictionResponse,
} from "@/types/api"

export const marketsApi = {
  // List open markets ordered by soonest closing
  getMarkets: async (limit = 20, offset = 0): Promise<MarketResponse[]> => {
    const { data } = await api.get<MarketResponse[]>("/markets", {
      params: { limit, offset },
    })
    return data
  },

  // Single market detail
  getMarket: async (id: number): Promise<MarketResponse> => {
    const { data } = await api.get<MarketResponse>(`/markets/${id}`)
    return data
  },

  // Place a bet on a market
  placeBet: async (marketId: number, body: PlaceBetRequest): Promise<BetResponse> => {
    const { data } = await api.post<BetResponse>(`/markets/${marketId}/bet`, body)
    return data
  },

  // Get the prediction linked to a market
  getPrediction: async (predictionId: number): Promise<PredictionResponse> => {
    const { data } = await api.get<PredictionResponse>(`/predictions/${predictionId}`)
    return data
  },
}