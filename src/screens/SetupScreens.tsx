// Journey A: programme lead sets up a collection (screens 1 to 3). Stubs for the build phase.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n'
import type { IdentityField } from '../types'

// Screen 1: purpose + end date are required before anything else
export function SetupPurpose() {
  const nav = useNavigate()
  const [purpose, setPurpose] = useState('')
  const [endDate, setEndDate] = useState('')
  const ok = purpose.trim().length > 10 && endDate !== ''
  return (
    <main>
      <h1>What is this collection for?</h1>
      <label className="q">
        <span>Purpose, in one sentence</span>
        <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} />
      </label>
      <label className="q">
        <span>Delete all data after</span>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </label>
      <button className="primary" disabled={!ok} onClick={() => nav('/setup/identity')}>Continue</button>
      {!ok && <p className="status">A purpose and an end date are required.</p>}
    </main>
  )
}

// Screen 2: "do you need this?" for every identifying field; default no
export function IdentityCheck() {
  const nav = useNavigate()
  const fields: IdentityField[] = ['name', 'phone', 'address']
  const [need, setNeed] = useState<Record<IdentityField, boolean>>({ name: false, phone: false, address: false })
  return (
    <main>
      <h1>Do you need these for this purpose?</h1>
      {fields.map((f) => (
        <fieldset key={f}>
          <legend>{f}</legend>
          <button className={need[f] ? 'on' : ''} onClick={() => setNeed({ ...need, [f]: true })}>Yes, needed</button>
          <button className={!need[f] ? 'on' : ''} onClick={() => setNeed({ ...need, [f]: false })}>No</button>
        </fieldset>
      ))}
      <button className="primary" onClick={() => nav('/setup/consent')}>Continue</button>
    </main>
  )
}

// Screen 3: consent script preview in both languages
export function ConsentPreview() {
  return (
    <main>
      <h1>Consent script</h1>
      <h2>English</h2>
      <p>{t('en', 'consentIntro')}</p>
      <h2>Yorùbá</h2>
      <p>{t('yo', 'consentIntro')}</p>
      <p className="status">Publishing to health workers comes in the build phase.</p>
    </main>
  )
}
