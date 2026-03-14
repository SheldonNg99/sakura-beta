import { Zap, TrendingUp, Bot, Users } from "lucide-react"

const FEATURES = [
  { icon: Bot, label: "AI Predictions", desc: "Machine learning models forecast short-term price movements" },
  { icon: TrendingUp, label: "Prediction Markets", desc: "Agree or disagree with the AI and earn credits if you're right" },
  { icon: Users, label: "Compete Globally", desc: "Track your win rate on the live leaderboard" },
]

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex">

      {/* ── Left panel (desktop only) ──────────────────────────────── */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-3/5 bg-foreground flex-col justify-between p-12 relative overflow-hidden">
        {/* Background grid decoration */}
        <div className="absolute inset-0 opacity-5"
          style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
            backgroundSize: "40px 40px"
          }}
        />

        {/* Logo */}
        <div className="flex items-center gap-3 relative z-10">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <Zap size={20} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="text-white font-bold text-xl tracking-tight">SakuraBeta</span>
        </div>

        {/* Hero text */}
        <div className="relative z-10 space-y-8">
          <div>
            <h1 className="text-4xl xl:text-5xl font-bold text-white leading-tight">
              Bet against
              <br />
              <span className="text-primary">the AI.</span>
              <br />
              Prove it wrong.
            </h1>
            <p className="text-white/50 mt-4 text-lg leading-relaxed max-w-md">
              AI-powered prediction markets where you take a position on whether our model is right or wrong. Real stakes. Real competition.
            </p>
          </div>

          {/* Feature list */}
          <div className="space-y-4">
            {FEATURES.map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon size={15} className="text-primary" />
                </div>
                <div>
                  <div className="text-white text-sm font-medium">{label}</div>
                  <div className="text-white/40 text-xs mt-0.5 leading-relaxed">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom tagline */}
        <div className="relative z-10">
          <p className="text-white/20 text-sm">Start with 100 free credits. No deposit required.</p>
        </div>
      </div>

      {/* ── Right panel — the form ─────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        {/* Mobile-only logo */}
        <div className="lg:hidden mb-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Zap size={16} className="text-white" strokeWidth={2.5} />
            </div>
            <span className="font-bold text-foreground text-lg tracking-tight">SakuraBeta</span>
          </div>
          <p className="text-sm text-muted-foreground">Bet against the AI. Prove it wrong.</p>
        </div>

        <div className="w-full max-w-sm">
          {children}
        </div>
      </div>

    </div>
  )
}