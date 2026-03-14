import { api } from "@/lib/api/axios"
import { LeaderboardResponse } from "@/types/api"

export const leaderboardApi = {
  getLeaderboard: async (): Promise<LeaderboardResponse> => {
    const { data } = await api.get<LeaderboardResponse>("/leaderboard")
    return data
  },
}