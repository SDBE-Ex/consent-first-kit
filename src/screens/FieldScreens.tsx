// Journey B: health worker collects in the field (screens 4 to 9).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadPublishedForms } from '../lib/forms'
import { t } from '../lib/i18n'
import { pendingCount, saveSubmission } from '../lib/localStore'
import { syncNow } from '../lib/sync'
import { newCheckCode, useVisit } from '../session'
import { say, type ConsentChoices, type Dataset, type IdentityField } from '../types'

// Screen 4: published forms (kept on the phone for offline use) + offline status
export function FormsList() {
  const nav = useNavigate()
  const { update, reset } = useVisit()
  const [count, setCount] = useState(0)
  const [forms, setForms] = useState<Dataset[]>([])
  const [source, setSource] = useState('')
  useEffect(() => {
    pendingCount().then(setCount)
    loadPublishedForms().then((r) => {
      setForms(r.forms)
      setSource(r.source === 'cache' ? 'saved copy' : r.source === 'demo' ? 'demo' : 'up to date')
    })
  }, [])
  return (
    <main>
      <h1>Assigned forms</h1>
      <p className="status">
        {navigator.onLine ? 'Online' : 'Offline'} · {count} {t('en', 'pending')} · forms {source}
      </p>
      {forms.map((f) => (
        <button
          key={f.id}
          className="card"
          onClick={() => {
            reset()
            update({ dataset: f })
            nav('/field/language')
          }}
        >
          <strong>{f.title}</strong>
          <span>Ends {f.end_date}</span>
        </button>
      ))}
      <button className="link" onClick={() => nav('/field/sync')}>Sync and storage</button>
      <button className="link" onClick={() => nav('/lead')}>Programme lead? Sign in</button>
    </main>
  )
}

// Screen 5: language choice + consent script (audio slot)
export function LanguageConsent() {
  const nav = useNavigate()
  const { visit, update } = useVisit()
  return (
    <main>
      <h1>{t(visit.lang, 'chooseLanguage')}</h1>
      <div className="row">
        <button className={visit.lang === 'yo' ? 'on' : ''} onClick={() => update({ lang: 'yo' })}>Yorùbá</button>
        <button className={visit.lang === 'en' ? 'on' : ''} onClick={() => update({ lang: 'en' })}>English</button>
      </div>
      <h2>{t(visit.lang, 'consentTitle')}</h2>
      {visit.dataset?.consent.map((c) => <p key={c.id}>{say(c, visit.lang)}</p>)}
      {visit.lang === 'yo' && visit.dataset?.consent.some((c) => !c.yo_approved) && (
        <p className="warn">Some lines have no approved Yoruba yet and are shown in English.</p>
      )}
      {/* Audio slot: approved Yoruba lines can be voiced via translate-draft (mode: speech) in the build phase */}
      <button className="primary" onClick={() => nav('/field/choices')}>{t(visit.lang, 'continue')}</button>
    </main>
  )
}

// Screen 6: three separate consent choices; AI training starts at no
export function ConsentChoicesScreen() {
  const nav = useNavigate()
  const { visit, update } = useVisit()
  const set = (k: keyof ConsentChoices, v: boolean) => update({ consent: { ...visit.consent, [k]: v } })
  const items: [keyof ConsentChoices, Parameters<typeof t>[1]][] = [
    ['care', 'choiceCare'],
    ['research', 'choiceResearch'],
    ['aiTraining', 'choiceAi'],
  ]
  const anyYes = Object.values(visit.consent).some(Boolean)
  return (
    <main>
      <h1>{t(visit.lang, 'consentTitle')}</h1>
      {items.map(([k, label]) => (
        <fieldset key={k}>
          <legend>{t(visit.lang, label)}</legend>
          <button className={visit.consent[k] ? 'on' : ''} onClick={() => set(k, true)}>{t(visit.lang, 'yes')}</button>
          <button className={!visit.consent[k] ? 'on' : ''} onClick={() => set(k, false)}>{t(visit.lang, 'no')}</button>
        </fieldset>
      ))}
      <button className="primary" onClick={() => nav(anyYes ? '/field/questions' : '/field/declined')}>
        {t(visit.lang, 'continue')}
      </button>
    </main>
  )
}

export function Declined() {
  const nav = useNavigate()
  const { visit, reset } = useVisit()
  return (
    <main>
      <h1>{t(visit.lang, 'noConsent')}</h1>
      <button className="primary" onClick={() => { reset(); nav('/') }}>OK</button>
    </main>
  )
}

// Screen 7: questions, saved under a code. Identity (only fields the form needs) is saved apart.
export function Questions() {
  const nav = useNavigate()
  const { visit, update } = useVisit()
  const [identity, setIdentity] = useState<Partial<Record<IdentityField, string>>>({})
  const ds = visit.dataset
  if (!ds) return <main><p>No form selected.</p></main>
  const setAns = (id: string, v: string) => update({ answers: { ...visit.answers, [id]: v } })
  async function save() {
    const checkCode = newCheckCode()
    const id = Object.fromEntries(Object.entries(identity).filter(([, v]) => v?.trim()))
    await saveSubmission({
      localId: crypto.randomUUID(),
      datasetId: ds!.id,
      checkCode,
      lang: visit.lang,
      consent: visit.consent,
      answers: visit.answers,
      identity: Object.keys(id).length ? id : undefined,
      createdAt: new Date().toISOString(),
    })
    update({ checkCode })
    nav('/field/done')
  }
  return (
    <main>
      <h1>{ds.title}</h1>
      {ds.questions.map((q) => (
        <label key={q.id} className="q">
          <span>{say(q, visit.lang)}</span>
          {q.kind === 'text' ? (
            <textarea value={visit.answers[q.id] ?? ''} onChange={(e) => setAns(q.id, e.target.value)} />
          ) : (
            <div className="col">
              {q.options?.map((o) => (
                <button key={o.en} className={visit.answers[q.id] === o.en ? 'on' : ''} onClick={() => setAns(q.id, o.en)}>
                  {say(o, visit.lang)}
                </button>
              ))}
            </div>
          )}
        </label>
      ))}
      {ds.identity_fields.length > 0 && (
        <>
          <h2>Contact details</h2>
          <p className="status">Only because this form needs them. Stored separately from the answers above.</p>
          {ds.identity_fields.map((f) => (
            <label key={f} className="q">
              <span>{f}</span>
              <input value={identity[f] ?? ''} onChange={(e) => setIdentity({ ...identity, [f]: e.target.value })} />
            </label>
          ))}
        </>
      )}
      <button className="primary" onClick={save}>Save</button>
    </main>
  )
}

// Screen 8: done + the person's check code
export function Done() {
  const nav = useNavigate()
  const { visit, reset } = useVisit()
  return (
    <main>
      <h1>{t(visit.lang, 'doneTitle')}</h1>
      <p>{t(visit.lang, 'checkCodeLabel')}</p>
      <p className="code">{visit.checkCode}</p>
      <button className="primary" onClick={() => { reset(); nav('/') }}>Next person</button>
    </main>
  )
}

// Screen 9: sync and storage view
export function SyncStatus() {
  const [count, setCount] = useState(0)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    pendingCount().then(setCount)
  }, [])
  async function run() {
    const r = await syncNow()
    setMsg(r.skipped ?? `Synced ${r.synced}`)
    setCount(await pendingCount())
  }
  return (
    <main>
      <h1>Sync and storage</h1>
      <p>{count} records encrypted on this phone, waiting to sync.</p>
      <p>Answers and identity are stored separately and removed from the phone after sync.</p>
      <button className="primary" onClick={run}>Sync now</button>
      {msg && <p className="status">{msg}</p>}
    </main>
  )
}
