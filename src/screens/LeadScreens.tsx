// Journey A: programme lead signs in, builds a form from a template, reviews Yoruba line by line, publishes.
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { sendMagicLink, signOut, useStaff } from '../lib/auth'
import { templates } from '../lib/demoData'
import {
  allLines, hasToneMarks, myForms, publishForm, registerFlag, saveForm, translateLine, type Draft,
} from '../lib/forms'
import { supabase } from '../lib/supabase'
import type { Dataset, IdentityField, Line, Question } from '../types'

const IDENTITY: IdentityField[] = ['name', 'phone', 'address']

function Gate({ children }: { children: React.ReactNode }) {
  const { session, role, loading } = useStaff()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')
  if (!supabase) return <main><p>Server not configured.</p></main>
  if (loading) return <main><p className="status">Loading…</p></main>
  if (!session)
    return (
      <main>
        <h1>Programme lead sign-in</h1>
        <p>We email you a sign-in link. No password.</p>
        <input type="email" placeholder="you@organisation.org" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="primary" disabled={!email.includes('@') || sent}
          onClick={() => sendMagicLink(email).then(() => setSent(true)).catch((e) => setErr(e.message))}>
          {sent ? 'Link sent, check your email' : 'Email me a sign-in link'}
        </button>
        {err && <p className="status">{err}</p>}
      </main>
    )
  if (role !== 'lead')
    return (
      <main>
        <h1>Waiting for access</h1>
        <p>Signed in as {session.user.email}. An admin needs to grant you the programme lead role before you can build forms.</p>
        <button onClick={signOut}>Sign out</button>
      </main>
    )
  return <>{children}</>
}

// ---------- Lead home: my forms + start from a template ----------
export function LeadHome() {
  return <Gate><LeadHomeInner /></Gate>
}
function LeadHomeInner() {
  const [forms, setForms] = useState<Dataset[]>([])
  const nav = useNavigate()
  useEffect(() => { myForms().then(setForms).catch(() => setForms([])) }, [])
  return (
    <main>
      <h1>Your forms</h1>
      {forms.length === 0 && <p className="status">No forms yet.</p>}
      {forms.map((f) => (
        <button key={f.id} className="card" onClick={() => nav(`/lead/form/${f.id}${f.status === 'draft' ? '' : '/review'}`)}>
          <strong>{f.title || 'Untitled'}</strong>
          <span>{f.status} · ends {f.end_date}</span>
        </button>
      ))}
      <h2>Start a new form</h2>
      {templates.map((t) => (
        <button key={t.key} onClick={() => nav(`/lead/form/new?template=${t.key}`)}>{t.name}</button>
      ))}
      <button className="link" onClick={signOut}>Sign out</button>
    </main>
  )
}

function newId(title: string) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'form'
  return `${slug}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`
}

function useForm(id: string | undefined, templateKey: string | null) {
  const [form, setForm] = useState<Dataset | null>(null)
  useEffect(() => {
    if (id && id !== 'new') {
      myForms().then((fs) => setForm(fs.find((f) => f.id === id) ?? null))
    } else {
      const t = templates.find((x) => x.key === templateKey) ?? templates[0]
      const end = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10)
      setForm({ ...t.build(), id: '', end_date: end, status: 'draft' })
    }
  }, [id, templateKey])
  return [form, setForm] as const
}

// ---------- Form editor (screens 1 and 2) ----------
export function FormEditor() {
  return <Gate><FormEditorInner /></Gate>
}
function FormEditorInner() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const nav = useNavigate()
  const [form, setForm] = useForm(id, params.get('template'))
  const [msg, setMsg] = useState('')
  if (!form) return <main><p className="status">Loading…</p></main>
  const set = (patch: Partial<Dataset>) => setForm({ ...form, ...patch })
  const setQ = (i: number, patch: Partial<Question>) =>
    set({ questions: form.questions.map((q, k) => (k === i ? { ...q, ...patch, yo_approved: patch.en !== undefined ? false : q.yo_approved } : q)) })
  const blank = (): Line => ({ en: '', yo: '', yo_approved: false })
  const ok = form.title.trim() && form.purpose.trim().length >= 10 && form.end_date && form.questions.every((q) => q.en.trim())

  async function save(next?: 'review') {
    const d = { ...form!, id: form!.id || newId(form!.title) }
    try {
      await saveForm(d)
      setForm(d)
      setMsg('Saved')
      if (next) nav(`/lead/form/${d.id}/review`)
      else if (!id || id === 'new') nav(`/lead/form/${d.id}`, { replace: true })
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  return (
    <main>
      <Link to="/lead">← Your forms</Link>
      <h1>{form.title || 'New form'}</h1>

      <label className="q"><span>Title</span>
        <input value={form.title} onChange={(e) => set({ title: e.target.value })} /></label>
      <label className="q"><span>Purpose, in one sentence (required)</span>
        <textarea value={form.purpose} onChange={(e) => set({ purpose: e.target.value })} /></label>
      <label className="q"><span>Delete all data after (required)</span>
        <input type="date" value={form.end_date} onChange={(e) => set({ end_date: e.target.value })} /></label>

      <h2>Do you need these for this purpose?</h2>
      <p className="status">Default is no. Every field you keep is stored apart from answers.</p>
      {IDENTITY.map((f) => {
        const on = form.identity_fields.includes(f)
        return (
          <fieldset key={f}><legend>{f}</legend>
            <button className={on ? 'on' : ''} onClick={() => set({ identity_fields: [...new Set([...form.identity_fields, f])] })}>Yes, needed</button>
            <button className={!on ? 'on' : ''} onClick={() => set({ identity_fields: form.identity_fields.filter((x) => x !== f) })}>No</button>
          </fieldset>
        )
      })}

      <h2>How should Yoruba address people?</h2>
      <div className="row">
        <button className={form.register === 'formal' ? 'on' : ''} onClick={() => set({ register: 'formal' })}>Respectful (ẹ / yín)</button>
        <button className={form.register === 'casual' ? 'on' : ''} onClick={() => set({ register: 'casual' })}>Casual (o / rẹ)</button>
      </div>

      <h2>Consent script</h2>
      {form.consent.map((c, i) => (
        <div key={c.id} className="row">
          <textarea value={c.en} onChange={(e) => set({ consent: form.consent.map((x, k) => (k === i ? { ...x, en: e.target.value, yo_approved: false } : x)) })} />
          <button onClick={() => set({ consent: form.consent.filter((_, k) => k !== i) })}>✕</button>
        </div>
      ))}
      <button onClick={() => set({ consent: [...form.consent, { id: `c${Date.now()}`, ...blank() }] })}>+ Consent line</button>

      <h2>Questions</h2>
      {form.questions.map((q, i) => (
        <div key={q.id} className="qcard">
          <textarea placeholder="Question in English" value={q.en} onChange={(e) => setQ(i, { en: e.target.value })} />
          <div className="row">
            <button className={q.kind === 'text' ? 'on' : ''} onClick={() => setQ(i, { kind: 'text', options: undefined })}>Free text</button>
            <button className={q.kind === 'single' ? 'on' : ''} onClick={() => setQ(i, { kind: 'single', options: q.options ?? [blank(), blank()] })}>Choices</button>
            <button onClick={() => set({ questions: form.questions.filter((_, k) => k !== i) })}>✕</button>
          </div>
          {q.kind === 'single' && q.options?.map((o, j) => (
            <div key={j} className="row">
              <input placeholder={`Choice ${j + 1}`} value={o.en}
                onChange={(e) => setQ(i, { options: q.options!.map((x, k) => (k === j ? { ...x, en: e.target.value, yo_approved: false } : x)) })} />
              <button onClick={() => setQ(i, { options: q.options!.filter((_, k) => k !== j) })}>✕</button>
            </div>
          ))}
          {q.kind === 'single' && <button className="link" onClick={() => setQ(i, { options: [...(q.options ?? []), blank()] })}>+ Choice</button>}
        </div>
      ))}
      <button onClick={() => set({ questions: [...form.questions, { id: `q${Date.now()}`, kind: 'text', ...blank() }] })}>+ Question</button>

      <button disabled={!ok} onClick={() => save()}>Save draft</button>
      <button className="primary" disabled={!ok} onClick={() => save('review')}>Save and review Yoruba</button>
      {!ok && <p className="status">Title, purpose, end date and every question's English text are required.</p>}
      {msg && <p className="status">{msg}</p>}
    </main>
  )
}

// ---------- Yoruba review (screen 3): African-made drafts, human approval line by line ----------
export function ReviewYoruba() {
  return <Gate><ReviewInner /></Gate>
}
function ReviewInner() {
  const { id } = useParams()
  const nav = useNavigate()
  const [form, setForm] = useForm(id, null)
  const [drafts, setDrafts] = useState<Record<string, Draft[]>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  if (!form) return <main><p className="status">Loading…</p></main>
  const locked = form.status !== 'draft'
  const lines = allLines(form)

  // Writes a change into the right line of the form by its key (consent.i / q.i / q.i.o.j).
  function update(key: string, patch: Partial<Line>) {
    const f = structuredClone(form!) as Dataset
    const p = key.split('.')
    if (p[0] === 'consent') Object.assign(f.consent[+p[1]], patch)
    else if (p.length === 2) Object.assign(f.questions[+p[1]], patch)
    else Object.assign(f.questions[+p[1]].options![+p[3]], patch)
    setForm(f)
  }

  async function getDrafts(key: string, en: string) {
    setBusy(key)
    try {
      const r = await translateLine(en)
      setDrafts((d) => ({ ...d, [key]: r.drafts }))
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const approved = lines.filter((l) => l.line.yo_approved && l.line.yo).length

  return (
    <main>
      <Link to="/lead">← Your forms</Link>
      <h1>Yoruba review</h1>
      <p>{form.title} · {approved} of {lines.length} lines approved</p>
      <p className="status">Machine drafts come from African-made engines. A native speaker must read and approve every line. Never paste people's answers here.</p>

      {lines.map(({ key, label, line }) => {
        const flag = line.yo ? registerFlag(line.yo, form.register) : null
        const noTone = line.yo && !hasToneMarks(line.yo)
        return (
          <div key={key} className={`qcard ${line.yo_approved ? 'approved' : ''}`}>
            <span className="status">{label}</span>
            <p><strong>{line.en || '(empty)'}</strong></p>
            {!locked && (
              <button disabled={busy === key || !line.en} onClick={() => getDrafts(key, line.en)}>
                {busy === key ? 'Getting drafts…' : 'Get Yoruba drafts'}
              </button>
            )}
            {drafts[key]?.map((d) => (
              <div key={d.engine} className="draft">
                <span className="status">{d.engine} ({d.madeIn})</span>
                {d.text ? <p>{d.text}</p> : <p className="status">No draft: {d.error}</p>}
                {d.text && !locked && <button className="link" onClick={() => update(key, { yo: d.text!, yo_approved: false })}>Use this draft</button>}
              </div>
            ))}
            <textarea placeholder="Yoruba (edit freely)" value={line.yo} disabled={locked}
              onChange={(e) => update(key, { yo: e.target.value, yo_approved: false })} />
            {flag && <p className="warn">⚠ {flag}</p>}
            {noTone && <p className="warn">⚠ No tone marks. Yoruba almost always needs them.</p>}
            <label className="check">
              <input type="checkbox" checked={line.yo_approved} disabled={locked || !line.yo.trim()}
                onChange={(e) => update(key, { yo_approved: e.target.checked })} />
              A native speaker has read and approved this line
            </label>
          </div>
        )
      })}

      {!locked && (
        <>
          <button onClick={() => saveForm(form).then(() => setMsg('Saved')).catch((e) => setMsg(e.message))}>Save progress</button>
          <button className="primary" disabled={approved < lines.length}
            onClick={async () => {
              try {
                await saveForm(form)
                await publishForm(form.id)
                setMsg('Published. Health workers will see it next time their phone is online.')
                setForm({ ...form, status: 'published' })
              } catch (e) { setMsg((e as Error).message) }
            }}>
            Publish to health workers
          </button>
          <button className="link" onClick={() => nav(`/lead/form/${form.id}`)}>Edit form</button>
        </>
      )}
      {locked && <p className="status">Published forms are frozen so everyone who consented saw the same words.</p>}
      {msg && <p className="status">{msg}</p>}
    </main>
  )
}
