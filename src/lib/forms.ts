// Form storage: leads save and publish; phones download published forms and keep them for offline use.
import { supabase } from './supabase'
import { demoDataset } from './demoData'
import type { Dataset, Line, Register } from '../types'

const CACHE_KEY = 'consent-kit.published-forms'

/** Published forms for the field app. Falls back to the cached copy offline, then to the demo. */
export async function loadPublishedForms(): Promise<{ forms: Dataset[]; source: 'server' | 'cache' | 'demo' }> {
  if (supabase && navigator.onLine) {
    const { data, error } = await supabase.rpc('published_forms')
    if (!error && data) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(data)) // form text only, never answers
      } catch { /* storage unavailable: still works online */ }
      return { forms: data as Dataset[], source: 'server' }
    }
  }
  try {
    const cached = localStorage.getItem(CACHE_KEY)
    if (cached) return { forms: JSON.parse(cached) as Dataset[], source: 'cache' }
  } catch { /* ignore */ }
  return { forms: [demoDataset], source: 'demo' }
}

export async function myForms(): Promise<Dataset[]> {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('my_forms')
  if (error) throw error
  return (data ?? []) as Dataset[]
}

export async function saveForm(d: Dataset) {
  if (!supabase) throw new Error('Server not configured')
  const { error } = await supabase.rpc('save_form', {
    p_id: d.id,
    p_title: d.title,
    p_purpose: d.purpose,
    p_end_date: d.end_date,
    p_identity_fields: d.identity_fields,
    p_questions: d.questions,
    p_consent: d.consent,
    p_register: d.register,
  })
  if (error) throw error
}

export async function publishForm(id: string) {
  if (!supabase) throw new Error('Server not configured')
  const { error } = await supabase.rpc('publish_form', { p_id: id })
  if (error) throw error
}

export interface Draft {
  engine: string
  madeIn: string
  text: string | null
  error?: string
}

/** Machine drafts for one line of FORM text. Never call this with a person's answers. */
export async function translateLine(en: string): Promise<{ drafts: Draft[]; flags: { engine: string; missingToneMarks: boolean }[] }> {
  if (!supabase) throw new Error('Server not configured')
  const { data, error } = await supabase.functions.invoke('translate-draft', { body: { text: en } })
  if (error) throw error
  return data
}

/** Every line a person will see, in reading order, so review can walk them one by one. */
export function allLines(d: Dataset): { key: string; label: string; line: Line }[] {
  const out: { key: string; label: string; line: Line }[] = []
  d.consent.forEach((c, i) => out.push({ key: `consent.${i}`, label: `Consent ${i + 1}`, line: c }))
  d.questions.forEach((q, i) => {
    out.push({ key: `q.${i}`, label: `Question ${i + 1}`, line: q })
    q.options?.forEach((o, j) => out.push({ key: `q.${i}.o.${j}`, label: `Q${i + 1} option ${j + 1}`, line: o }))
  })
  return out
}

/** Flags a Yoruba line that mixes casual (rẹ/o) and respectful (yín/ẹ) "you" forms, or misses the chosen register. */
export function registerFlag(yo: string, register: Register): string | null {
  const words = yo.toLowerCase().normalize('NFC').split(/[^\p{L}\p{M}]+/u)
  // Heuristic only: it prompts the reviewer to look, it never blocks approval.
  const has = (forms: string[]) => words.some((w) => forms.includes(w.normalize('NFC')))
  const casual = has(['rẹ', 'o', 'ìwọ'].map((s) => s.normalize('NFC')))
  const formal = has(['yín', 'ẹ', 'ẹ̀yin', 'ẹ̀'].map((s) => s.normalize('NFC')))
  if (casual && formal) return 'Mixes casual and respectful "you" in one line'
  if (register === 'formal' && casual) return 'Uses casual "you" but this form is set to respectful'
  if (register === 'casual' && formal) return 'Uses respectful "you" but this form is set to casual'
  return null
}

export function hasToneMarks(s: string) {
  return /[̣̀́]/.test(s.normalize('NFD'))
}
