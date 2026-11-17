// Core domain types. Mirrors supabase/migrations/0001_init.sql.

export type Lang = 'en' | 'yo'

/** Principle 4: no dataset without a purpose and an end date. */
export interface Dataset {
  id: string
  title: string
  purpose: string
  endDate: string // ISO date; data is deleted after this
  identityFields: IdentityField[] // only fields the lead confirmed are needed
  questions: Question[]
}

export type IdentityField = 'name' | 'phone' | 'address'

export interface Question {
  id: string
  label: Record<Lang, string>
  kind: 'text' | 'single' | 'scale'
  options?: Record<Lang, string>[]
}

/** Principle 3: three separate choices. AI training defaults to false. */
export interface ConsentChoices {
  care: boolean
  research: boolean
  aiTraining: boolean
}

/** One field visit, held encrypted on the phone until sync. */
export interface PendingSubmission {
  localId: string
  datasetId: string
  checkCode: string // given to the person so they can check or change consent
  lang: Lang
  consent: ConsentChoices
  answers: Record<string, string> // keyed by question id, never contains identity
  identity?: Partial<Record<IdentityField, string>> // stored apart, only if needed
  createdAt: string
}
