// Offline storage on the health worker's phone.
// - Every record is encrypted with a non-extractable device key (WebCrypto AES-GCM).
// - Answers and identity live in separate stores, linked only by checkCode.
// - Records are removed after a successful sync.
import { openDB, type IDBPDatabase } from 'idb'
import type { PendingSubmission } from '../types'

const DB_NAME = 'consent-kit'
const DB_VERSION = 1

interface Encrypted {
  iv: Uint8Array
  data: ArrayBuffer
}

let dbPromise: Promise<IDBPDatabase> | null = null

function db() {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(d) {
      d.createObjectStore('keys')
      d.createObjectStore('answers') // key: localId
      d.createObjectStore('identity') // key: localId, only when needed
    },
  })
  return dbPromise
}

async function deviceKey(): Promise<CryptoKey> {
  const d = await db()
  const existing = (await d.get('keys', 'device')) as CryptoKey | undefined
  if (existing) return existing
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
  await d.put('keys', key, 'device')
  return key
}

async function encrypt(value: unknown): Promise<Encrypted> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await deviceKey(),
    new TextEncoder().encode(JSON.stringify(value)),
  )
  return { iv, data }
}

async function decrypt<T>(rec: Encrypted): Promise<T> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: rec.iv as Uint8Array<ArrayBuffer> },
    await deviceKey(),
    rec.data,
  )
  return JSON.parse(new TextDecoder().decode(plain)) as T
}

/** Save a field submission, splitting identity from answers at the moment of saving. */
export async function saveSubmission(sub: PendingSubmission) {
  const { identity, ...rest } = sub
  const d = await db()
  await d.put('answers', await encrypt(rest), sub.localId)
  if (identity && Object.keys(identity).length > 0) {
    await d.put('identity', await encrypt({ checkCode: sub.checkCode, identity }), sub.localId)
  }
}

export async function listPending(): Promise<PendingSubmission[]> {
  const d = await db()
  const ids = (await d.getAllKeys('answers')) as string[]
  const out: PendingSubmission[] = []
  for (const id of ids) {
    const rec = (await d.get('answers', id)) as Encrypted
    const sub = await decrypt<PendingSubmission>(rec)
    const idRec = (await d.get('identity', id)) as Encrypted | undefined
    if (idRec) sub.identity = (await decrypt<{ identity: PendingSubmission['identity'] }>(idRec)).identity
    out.push(sub)
  }
  return out
}

/** Called after the server confirms a sync. */
export async function clearSubmission(localId: string) {
  const d = await db()
  await d.delete('answers', localId)
  await d.delete('identity', localId)
}

export async function pendingCount() {
  return (await db()).count('answers')
}
