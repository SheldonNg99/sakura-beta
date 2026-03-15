// frontend/src/lib/api/agents.ts
import { api } from "@/lib/api/axios"
import { AgentResponse, AgentDetailResponse } from "@/types/api"

export const agentsApi = {
  /**
   * Upload a new agent script.
   * Sends multipart/form-data — name as a form field, .py as a file.
   */
  upload: async (name: string, file: File): Promise<AgentDetailResponse> => {
    const form = new FormData()
    form.append("name", name)
    form.append("file", file, file.name)

    const { data } = await api.post<AgentDetailResponse>("/agents", form, {
      headers: { "Content-Type": "multipart/form-data" },
    })
    return data
  },

  /** Returns the current user's agents, newest first. */
  listMine: async (): Promise<AgentResponse[]> => {
    const { data } = await api.get<AgentResponse[]>("/agents")
    return data
  },

  /** Returns all active agents (public, no auth required). */
  listPublic: async (): Promise<AgentResponse[]> => {
    const { data } = await api.get<AgentResponse[]>("/agents/public")
    return data
  },

  /** Returns full detail including source code — owner only. */
  getById: async (id: number): Promise<AgentDetailResponse> => {
    const { data } = await api.get<AgentDetailResponse>(`/agents/${id}`)
    return data
  },

  /** Soft-deactivates an agent — owner only. */
  deactivate: async (id: number): Promise<AgentResponse> => {
    const { data } = await api.patch<AgentResponse>(`/agents/${id}/deactivate`)
    return data
  },
}