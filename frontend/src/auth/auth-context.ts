import { createContext } from 'react'

import type { AuthTokens, CurrentUser } from '@/api/client'

export type AuthStatus =
  | 'loading'
  | 'authenticated'
  | 'unauthenticated'
  | 'unavailable'

export type SignInInput = {
  email: string
  password: string
}

export type ChangePasswordInput = {
  currentPassword: string
  newPassword: string
}

export type AuthContextValue = {
  accessToken: string | null
  currentUser: CurrentUser | null
  changePassword: (input: ChangePasswordInput) => Promise<void>
  error: string | null
  signIn: (input: SignInInput) => Promise<CurrentUser>
  signOut: () => void
  signOutAll: () => Promise<void>
  status: AuthStatus
  tokens: AuthTokens | null
  updateCurrentUser: (user: CurrentUser) => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
