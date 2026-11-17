// Journey B: health worker collects in the field (screens 4 to 9).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { demoDataset } from '../lib/demoData'
import { t } from '../lib/i18n'
import { pendingCount, saveSubmission } from '../lib/localStore'
import { syncNow } from '../lib/sync'
import { newCheckCode, useVisit } from '../session'
import type { ConsentChoices } from '../types'

// Screen 4: assigned forms + offline status
export function FormsList() {
  const nav = useNavigate()
  const { update, reset } = useVisit()
  const [count, setCount] = useState(0)
  useEffect(() => {
    pendingCount().then(setCount)
  }, [])
  return (
    <main>
      <h1>Assigned forms</h1>
      <p className="status">{navigator.onLine ? 'Online' : 'Offline'} · {count} {t('en', 'pending')}</p>
      <button
        className="card"
        onClick={() => {
          reset()
          update({ dataset: demoDataset })
          nav('/field/language')
        }}
      >
        <strong>{demoDataset.title}</strong>
        <span>Ends {demoDataset.endDate}</span>
      </button>
      <button className="link" onClick={() => nav('/field/sync')}>Sync and storage</button>
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
      <p>{t(visit.lang, 'consentIntro')}</p>
      {/* TODO: <audio src={`/audio/consent-${visit.lang}.mp3`} controls /> once recorded by a native speaker */}
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

// Screen 7: questions, saved under a code (identity never mixed in)
export function Questions() {
  const nav = useNavigate()
  const { visit, update } = useVisit()
  const ds = visit.dataset
  if (!ds) return <main><p>No form selected.</p></main>
  const setAns = (id: string, v: string) => update({ answers: { ...visit.answers, [id]: v } })
  const label = (r: Record<'en' | 'yo', string>) => r[visit.lang] || r.en
  async function save() {
    const checkCode = newCheckCode()
    await saveSubmission({
      localId: crypto.randomUUID(),
      datasetId: ds!.id,
      checkCode,
      lang: visit.lang,
      consent: visit.consent,
      answers: visit.answers,
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
          <span>{label(q.label)}</span>
          {q.kind === 'text' ? (
            <textarea value={visit.answers[q.id] ?? ''} onChange={(e) => setAns(q.id, e.target.value)} />
          ) : (
            <div className="col">
              {q.options?.map((o) => (
                <button key={o.en} className={visit.answers[q.id] === o.en ? 'on' : ''} onClick={() => setAns(q.id, o.en)}>
                  {label(o)}
                </button>
              ))}
            </div>
          )}
        </label>
      ))}
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
