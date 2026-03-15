"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { agentsApi } from "@/lib/api/agents"
import { AgentResponse } from "@/types/api"
import { AxiosError } from "axios"
import {
  Bot,
  Upload,
  CheckCircle2,
  XCircle,
  FileCode2,
  ChevronDown,
  Loader2,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

// ── Example agent template shown in the upload panel ──────────────────────────

const TEMPLATE = `def predict(asset: str, price: float, candles: list) -> dict:
    """
    Args:
        asset:   e.g. "BTC-USD"
        price:   current price as float
        candles: list of up to 20 dicts, each:
                 { open, high, low, close, volume }

    Returns:
        { "direction": "up" | "down", "confidence": 0.0–1.0 }
    """
    # Simple example: last candle momentum
    if len(candles) < 2:
        return { "direction": "up", "confidence": 0.5 }

    last  = candles[-1]["close"]
    prev  = candles[-2]["close"]
    delta = (last - prev) / prev

    if delta > 0:
        return { "direction": "up",   "confidence": min(0.9, 0.5 + abs(delta) * 50) }
    else:
        return { "direction": "down", "confidence": min(0.9, 0.5 + abs(delta) * 50) }
`

// ── Upload Panel ───────────────────────────────────────────────────────────────

function UploadPanel({ onUploaded }: { onUploaded: (agent: AgentResponse) => void }) {
  const [name, setName] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [showTemplate, setShowTemplate] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = (f: File) => {
    setFileError(null)
    if (!f.name.endsWith(".py")) {
      setFileError("Only .py files are accepted")
      return
    }
    if (f.size > 1024 * 1024) {
      setFileError("File exceeds 1MB limit")
      return
    }
    setFile(f)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) handleFile(dropped)
  }

  const handleSubmit = async () => {
    let valid = true
    if (!name.trim()) { setNameError("Agent name is required"); valid = false }
    else if (name.trim().length > 100) { setNameError("Name must be 100 characters or less"); valid = false }
    else setNameError(null)

    if (!file) { setFileError("Select a .py file to upload"); valid = false }
    else setFileError(null)

    if (!valid) return

    setIsLoading(true)
    try {
      const agent = await agentsApi.upload(name.trim(), file!)
      toast.success(`Agent "${agent.name}" uploaded and validated!`)
      onUploaded(agent)
      setName("")
      setFile(null)
    } catch (err) {
      const e = err as AxiosError<{ detail: string }>
      toast.error(e.response?.data?.detail ?? "Upload failed. Check your script and try again.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="bg-card rounded-2xl ring-1 ring-foreground/10 overflow-hidden">

      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Upload size={15} className="text-primary" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">Upload Agent</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Your script will run every 15 min on BTC &amp; ETH
          </p>
        </div>
      </div>

      <div className="p-5 space-y-4">

        {/* Name */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Agent Name
          </label>
          <Input
            placeholder="e.g. MomentumBot Alpha"
            value={name}
            onChange={(e) => { setName(e.target.value); setNameError(null) }}
            className="h-10 bg-background"
            disabled={isLoading}
            maxLength={100}
          />
          {nameError && <p className="text-xs text-destructive pl-1">{nameError}</p>}
        </div>

        {/* File drop zone */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Script File (.py, max 1MB)
          </label>
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`
              relative flex flex-col items-center justify-center gap-2
              rounded-xl border-2 border-dashed p-6 cursor-pointer
              transition-colors duration-150
              ${isDragging
                ? "border-primary bg-primary/5"
                : file
                  ? "border-emerald-500/50 bg-emerald-500/5"
                  : "border-border bg-background hover:border-primary/40 hover:bg-primary/5"
              }
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".py"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
            {file ? (
              <>
                <FileCode2 size={24} className="text-emerald-500" />
                <div className="text-center">
                  <p className="text-sm font-medium text-emerald-600">{file.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {(file.size / 1024).toFixed(1)} KB — click to replace
                  </p>
                </div>
              </>
            ) : (
              <>
                <FileCode2 size={24} className="text-muted-foreground/50" />
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">
                    Drop your <span className="font-medium text-foreground">.py</span> file here
                  </p>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">or click to browse</p>
                </div>
              </>
            )}
          </div>
          {fileError && <p className="text-xs text-destructive pl-1">{fileError}</p>}
        </div>

        {/* Submit */}
        <Button
          onClick={handleSubmit}
          disabled={isLoading}
          className="w-full h-10 gap-2"
        >
          {isLoading ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              Validating &amp; uploading...
            </>
          ) : (
            <>
              <Sparkles size={15} />
              Upload Agent
            </>
          )}
        </Button>
      </div>

      {/* Collapsible template */}
      <div className="border-t border-border">
        <button
          onClick={() => setShowTemplate((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <span className="font-medium">View starter template</span>
          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ${showTemplate ? "rotate-180" : ""}`}
          />
        </button>
        {showTemplate && (
          <div className="px-5 pb-4">
            <pre className="text-xs bg-muted/50 rounded-xl p-4 overflow-x-auto text-foreground/80 leading-relaxed font-mono">
              {TEMPLATE}
            </pre>
            <p className="text-xs text-muted-foreground mt-2">
              Your script must define{" "}
              <code className="text-foreground bg-muted px-1 py-0.5 rounded">predict(asset, price, candles)</code>{" "}
              and return a dict with{" "}
              <code className="text-foreground bg-muted px-1 py-0.5 rounded">direction</code> and{" "}
              <code className="text-foreground bg-muted px-1 py-0.5 rounded">confidence</code>.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Agent Card ─────────────────────────────────────────────────────────────────

function AgentCard({
  agent,
  onDeactivate,
}: {
  agent: AgentResponse
  onDeactivate: (id: number) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleDeactivate = async () => {
    if (!confirming) { setConfirming(true); return }
    setLoading(true)
    try {
      await agentsApi.deactivate(agent.id)
      toast.success(`Agent "${agent.name}" deactivated.`)
      onDeactivate(agent.id)
    } catch (err) {
      const e = err as AxiosError<{ detail: string }>
      toast.error(e.response?.data?.detail ?? "Failed to deactivate agent.")
    } finally {
      setLoading(false)
      setConfirming(false)
    }
  }

  return (
    <div className={`
      flex items-start gap-3 py-4 border-b border-border last:border-0
      transition-opacity duration-200
      ${!agent.is_active ? "opacity-50" : ""}
    `}>
      {/* Icon */}
      <div className={`
        w-9 h-9 rounded-xl flex items-center justify-center shrink-0
        ${agent.is_active ? "bg-primary/10" : "bg-muted"}
      `}>
        <Bot size={16} className={agent.is_active ? "text-primary" : "text-muted-foreground"} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-foreground truncate">{agent.name}</span>
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 h-4 ${
              agent.is_active
                ? "border-emerald-500/30 text-emerald-600 bg-emerald-500/10"
                : "border-border text-muted-foreground"
            }`}
          >
            {agent.is_active ? (
              <><CheckCircle2 size={9} className="mr-1" />Active</>
            ) : (
              <><XCircle size={9} className="mr-1" />Inactive</>
            )}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Uploaded {formatDate(agent.created_at)} · ID #{agent.id}
        </p>
      </div>

      {/* Deactivate */}
      {agent.is_active && (
        <button
          onClick={handleDeactivate}
          disabled={loading}
          className={`
            text-xs px-2.5 py-1 rounded-lg border transition-colors shrink-0
            ${confirming
              ? "border-destructive/40 text-destructive bg-destructive/5 hover:bg-destructive/10"
              : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
            }
          `}
        >
          {loading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : confirming ? (
            "Confirm?"
          ) : (
            "Deactivate"
          )}
        </button>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    agentsApi.listMine()
      .then(setAgents)
      .catch(() => setError("Failed to load your agents."))
      .finally(() => setLoading(false))
  }, [])

  const handleUploaded = (agent: AgentResponse) => {
    setAgents((prev) => [agent, ...prev])
  }

  const handleDeactivated = (id: number) => {
    setAgents((prev) =>
      prev.map((a) => (a.id === id ? { ...a, is_active: false } : a))
    )
  }

  const active   = agents.filter((a) => a.is_active)
  const inactive = agents.filter((a) => !a.is_active)

  return (
    <div className="pt-6 max-w-2xl space-y-6">

      {/* Title */}
      <div>
        <h1 className="text-xl font-bold text-foreground">My Agents</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Upload a Python script — it runs every 15 minutes and opens markets on its predictions.
        </p>
      </div>

      {/* Upload panel */}
      <UploadPanel onUploaded={handleUploaded} />

      {/* Agent list */}
      <div className="bg-card rounded-2xl ring-1 ring-foreground/10 overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Your Agents</h2>
          <span className="text-xs text-muted-foreground">
            {active.length} active{inactive.length > 0 ? ` · ${inactive.length} inactive` : ""}
          </span>
        </div>

        {loading ? (
          <div className="py-12 flex justify-center">
            <Loader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="py-12 text-center text-muted-foreground text-sm">{error}</div>
        ) : agents.length === 0 ? (
          <div className="py-12 text-center space-y-2">
            <Bot size={32} className="mx-auto text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No agents yet.</p>
            <p className="text-xs text-muted-foreground/60">Upload your first script above to get started.</p>
          </div>
        ) : (
          <div className="px-5">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onDeactivate={handleDeactivated}
              />
            ))}
          </div>
        )}
      </div>

      {/* Sandbox rules callout */}
      <div className="rounded-xl bg-amber-500/8 border border-amber-500/20 px-4 py-3 space-y-1">
        <p className="text-xs font-semibold text-amber-600">Sandbox Rules</p>
        <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside">
          <li>5 second execution timeout per run</li>
          <li>No network, file system, or OS access</li>
          <li>Allowed imports: <code className="text-foreground bg-muted px-1 rounded">math</code>, <code className="text-foreground bg-muted px-1 rounded">numpy</code>, <code className="text-foreground bg-muted px-1 rounded">pandas</code>, <code className="text-foreground bg-muted px-1 rounded">statistics</code>, <code className="text-foreground bg-muted px-1 rounded">ta</code></li>
          <li>Must return <code className="text-foreground bg-muted px-1 rounded">{"{ direction, confidence }"}</code> — no exceptions</li>
        </ul>
      </div>

    </div>
  )
}