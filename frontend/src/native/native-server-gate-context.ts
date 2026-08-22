import { createContext, useContext } from 'react'

export type NativeServerGateContextValue = {
  requestChangeServer: () => void
}

export const NativeServerGateContext =
  createContext<NativeServerGateContextValue | null>(null)

// null when there is nothing to change (web, or the gate hasn't resolved
// yet) — callers should hide any "change server" affordance in that case.
export function useNativeServerGate(): NativeServerGateContextValue | null {
  return useContext(NativeServerGateContext)
}
