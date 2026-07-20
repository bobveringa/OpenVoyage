import { createContext } from 'react'

import type { AuthTokens, CurrentUser } from '@/api/client'

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

export type SignInInput = {
  email: string
  password: string
}

export type AuthContextValue = {
  accessToken: string | null
  currentUser: CurrentUser | null
  error: string | null
  signIn: (input: SignInInput) => Promise<CurrentUser>
  signOut: () => void
  status: AuthStatus
  tokens: AuthTokens | null
  updateCurrentUser: (user: CurrentUser) => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
