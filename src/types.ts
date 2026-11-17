// Core domain types. Mirrors supabase/migrations/0001 and 0002.

export type Lang = 'en' | 'yo'
export type IdentityField = 'name' | 'phone' | 'address'
export type Register = 'formal' | 'casual'

/** One piece of text shown to people, in English plus a human-approved Yoruba version. */
export interface Line {
  en: string
  yo: string
  yo_approved: boolean
}

export interface Question extends Line {
  id: string
  kind: 'text' | 'single'
  options?: Line[]
}

export interface ConsentLine extends Line {
  id: string
}

/** Principle 4: no form without a purpose and an end date. */
export interface Dataset {
  id: string
  title: string
  purpose: string
  end_date: string // ISO date; data is deleted after this
  identity_fields: IdentityField[]
  questions: Question[]
  consent: ConsentLine[]
  register: Register
  status?: 'draft' | 'published' | 'closed'
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
  checkCode: string
  lang: Lang
  consent: ConsentChoices
  answers: Record<string, string> // keyed by question id, never contains identity
  identity?: Partial<Record<IdentityField, string>> // stored apart, only if needed
  createdAt: string
}

/** Text in the person's language: approved Yoruba, otherwise English. */
export function say(line: Line, lang: Lang): string {
  return lang === 'yo' && line.yo_approved && line.yo ? line.yo : line.en
}
