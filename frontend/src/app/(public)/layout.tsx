import AppNav from "@/components/layout/AppNav"

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="lg:ml-60 pb-20 lg:pb-0">
        <div className="max-w-5xl mx-auto px-4 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  )
}