// Journey C: check or change your choices later, with the code you were given.
// No sign-in and no name. If all three choices are set to no, the answers are withdrawn.
import { useState } from 'react'
import { changeConsent, lookupConsent, normaliseCode, type ConsentState } from '../lib/consentCheck'

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

export function ConsentCheck() {
  const [raw, setRaw] = useState('')
  const [code, setCode] = useState<string | null>(null)
  const [state, setState] = useState<ConsentState | null>(null)
  const [choices, setChoices] = useState({ care: false, research: false, ai: false })
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function find() {
    setErr(''); setNote('')
    const c = normaliseCode(raw)
    if (!c) { setErr('The code has 8 letters and numbers, like ABCD-EFGH.'); return }
    setBusy(true)
    try {
      const s = await lookupConsent(c)
      if (!s) { setErr('We could not find that code. Check it and try again.'); return }
      setCode(c); setState(s)
      setChoices({ care: s.care, research: s.research, ai: s.ai_training })
    } catch (e) {
      setErr(message(e, 'Could not check the code'))
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!code) return
    const withdrawing = !choices.care && !choices.research && !choices.ai
    if (withdrawing && !window.confirm('All three are No. Your answers will be withdrawn and not used again. Continue?')) return
    setBusy(true); setErr('')
    try {
      await changeConsent(code, choices.care, choices.research, choices.ai)
      const s = await lookupConsent(code)
      if (s) setState(s)
      setNote(withdrawing ? 'Your answers are withdrawn. They will not be used again.' : 'Saved. Your new choices apply from now on.')
    } catch (e) {
      setErr(message(e, 'Could not save your choices'))
    } finally {
      setBusy(false)
    }
  }

  const row = (k: 'care' | 'research' | 'ai', label: string) => (
    <fieldset key={k}>
      <legend>{label}</legend>
      <button className={choices[k] ? 'on' : ''} onClick={() => setChoices({ ...choices, [k]: true })}>Yes</button>
      <button className={!choices[k] ? 'on' : ''} onClick={() => setChoices({ ...choices, [k]: false })}>No</button>
    </fieldset>
  )

  if (!state)
    return (
      <main>
        <h1>Check or change your choices</h1>
        <p>Type the code you were given when you answered the questions. You do not need your name.</p>
        <input
          placeholder="ABCD-EFGH"
          value={raw}
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={12}
          onChange={(e) => setRaw(e.target.value)}
        />
        {err && <p className="status">{err}</p>}
        <button className="primary" disabled={busy || !raw.trim()} onClick={find}>Find my choices</button>
        <p className="status">Keep your code to yourself. Anyone who has it can change your choices.</p>
      </main>
    )

  return (
    <main>
      <h1>Your choices</h1>
      <p>These answers were collected for: {state.purpose}. They will be deleted after {new Date(state.end_date).toLocaleDateString()}.</p>
      {state.withdrawn && <p className="warn">Your answers are withdrawn. You can turn a choice back on below.</p>}
      {row('care', 'Use my answers for my care')}
      {row('research', 'Use my answers for research, without my name')}
      {row('ai', 'Use my answers to train AI tools')}
      {err && <p className="status">{err}</p>}
      {note && <p className="status">{note}</p>}
      <button className="primary" disabled={busy} onClick={save}>Save my choices</button>
      <button className="link" onClick={() => { setState(null); setCode(null); setRaw(''); setNote('') }}>Use a different code</button>
    </main>
  )
}
