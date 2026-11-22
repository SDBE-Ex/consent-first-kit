import { createContext, useContext, useState, type ReactNode } from 'react'
import type { ConsentChoices, Dataset, Lang } from './types'

// One field visit in progress (Journey B). Lives in memory only until saved encrypted.
interface Visit {
  dataset: Dataset | null
  lang: Lang
  consent: ConsentChoices
  answers: Record<string, string>
  checkCode: string | null
}

const fresh = (): Visit => ({
  dataset: null,
  lang: 'en',
  consent: { care: false, research: false, aiTraining: false },
  answers: {},
  checkCode: null,
})

const Ctx = createContext<{
  visit: Visit
  update: (patch: Partial<Visit>) => void
  reset: () => void
} | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [visit, setVisit] = useState<Visit>(fresh)
  return (
    <Ctx.Provider
      value={{
        visit,
        update: (patch) => setVisit((v) => ({ ...v, ...patch })),
        reset: () => setVisit(fresh()),
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useVisit() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useVisit outside SessionProvider')
  return c
}

