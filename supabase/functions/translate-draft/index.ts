// translate-draft: returns machine DRAFTS of form text (questions, consent lines) in Yoruba.
// Rules:
//  - Form content only. Never call this with a person's answers.
//  - Output is a draft for a native speaker to approve; it is never sent to phones directly.
//  - African-made engines first. Khaya (GhanaNLP) is engine #1; more engines plug in below.
// Secrets (set in Supabase > Edge Functions > Secrets): KHAYA_API_KEY

const KHAYA_BASE = 'https://translation-api.ghananlp.org'
const MAX_CHARS = 600 // short form lines only; stops misuse as a general translator

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Draft = { engine: string; madeIn: string; text: string | null; error?: string }

async function khayaTranslate(text: string, key: string): Promise<Draft> {
  try {
    const r = await fetch(`${KHAYA_BASE}/v1/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': key },
      body: JSON.stringify({ in: text, lang: 'en-yo' }),
    })
    if (!r.ok) return { engine: 'khaya', madeIn: 'Ghana', text: null, error: `HTTP ${r.status}` }
    const out = await r.json()
    return { engine: 'khaya', madeIn: 'Ghana', text: typeof out === 'string' ? out : JSON.stringify(out) }
  } catch (e) {
    return { engine: 'khaya', madeIn: 'Ghana', text: null, error: String(e) }
  }
}

async function khayaSpeech(text: string, key: string): Promise<Response> {
  return fetch(`${KHAYA_BASE}/tts/v1/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': key },
    body: JSON.stringify({ text, language: 'yor' }),
  })
}

/** Yoruba relies on tone marks; a draft with none is almost certainly wrong. */
function hasToneMarks(s: string) {
  // After NFD, grave (0300), acute (0301) and dot-below (0323, as in ẹ ọ ṣ) become separate marks.
  return /[̣̀́]/.test(s.normalize('NFD'))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: cors })

  const key = Deno.env.get('KHAYA_API_KEY')
  if (!key) return Response.json({ error: 'KHAYA_API_KEY not set' }, { status: 500, headers: cors })

  let body: { text?: string; mode?: 'translate' | 'speech' }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'JSON body required' }, { status: 400, headers: cors })
  }
  const text = (body.text ?? '').trim()
  if (!text || text.length > MAX_CHARS) {
    return Response.json({ error: `text required, max ${MAX_CHARS} chars` }, { status: 400, headers: cors })
  }

  if (body.mode === 'speech') {
    // text here is the APPROVED Yoruba line; returns WAV audio for the consent script
    const r = await khayaSpeech(text, key)
    if (!r.ok) return Response.json({ error: `speech HTTP ${r.status}` }, { status: 502, headers: cors })
    return new Response(r.body, { headers: { ...cors, 'Content-Type': r.headers.get('content-type') ?? 'audio/wav' } })
  }

  const drafts: Draft[] = await Promise.all([
    khayaTranslate(text, key),
    // N-ATLaS (Nigeria) and Vulavula (South Africa) plug in here once access is set up.
  ])
  const flagged = drafts
    .filter((d) => d.text)
    .map((d) => ({ engine: d.engine, missingToneMarks: !hasToneMarks(d.text!) }))

  return Response.json(
    { source: text, target: 'yo', status: 'draft_needs_native_review', drafts, flags: flagged },
    { headers: cors },
  )
})
