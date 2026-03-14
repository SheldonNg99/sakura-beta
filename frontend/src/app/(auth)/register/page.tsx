"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { authApi } from "@/lib/api/auth"
import { useAuthStore } from "@/lib/store/auth"
import { AxiosError } from "axios"

export default function RegisterPage() {
  const router = useRouter()
  const { setAuth } = useAuthStore()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [errors, setErrors] = useState<{
    email?: string
    password?: string
    confirm?: string
  }>({})
  const [isLoading, setIsLoading] = useState(false)

  const validate = () => {
    const newErrors: typeof errors = {}
    if (!email) newErrors.email = "Email is required"
    else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = "Enter a valid email"
    if (!password) newErrors.password = "Password is required"
    else if (password.length < 8) newErrors.password = "Password must be at least 8 characters"
    if (!confirm) newErrors.confirm = "Please confirm your password"
    else if (password !== confirm) newErrors.confirm = "Passwords do not match"
    return newErrors
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const validationErrors = validate()
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    setIsLoading(true)
    setErrors({})

    try {
      // Register then immediately log in
      await authApi.register({ email, password })
      const { access_token } = await authApi.login({ email, password })
      const user = await authApi.me()
      setAuth(access_token, user)
      toast.success("Welcome! You've been given 100 credits to start.")
      router.replace("/markets")
    } catch (err) {
      const error = err as AxiosError<{ detail: string }>
      const message = error.response?.data?.detail || "Registration failed. Try again."
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card className="bg-card border-0 shadow-sm page-fade">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg font-semibold">Create account</CardTitle>
        <p className="text-sm text-muted-foreground">
          Start with 100 free credits
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email */}
          <div className="space-y-1">
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 bg-background border-border"
              disabled={isLoading}
              autoComplete="email"
            />
            {errors.email && (
              <p className="text-xs text-destructive pl-1">{errors.email}</p>
            )}
          </div>

          {/* Password */}
          <div className="space-y-1">
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 bg-background border-border"
              disabled={isLoading}
              autoComplete="new-password"
            />
            {errors.password && (
              <p className="text-xs text-destructive pl-1">{errors.password}</p>
            )}
          </div>

          {/* Confirm password */}
          <div className="space-y-1">
            <Input
              type="password"
              placeholder="Confirm password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="h-12 bg-background border-border"
              disabled={isLoading}
              autoComplete="new-password"
            />
            {errors.confirm && (
              <p className="text-xs text-destructive pl-1">{errors.confirm}</p>
            )}
          </div>

          {/* Submit */}
          <Button
            type="submit"
            className="w-full h-12 bg-primary hover:bg-primary/90 text-white font-medium"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Creating account...
              </span>
            ) : (
              "Create account"
            )}
          </Button>
        </form>

        {/* Link to login */}
        <p className="text-center text-sm text-muted-foreground mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-primary font-medium">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}