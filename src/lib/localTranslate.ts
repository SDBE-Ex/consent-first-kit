// Second draft engine: Adelani m2m100 (Nigeria), run in the browser via Transformers.js.
// Model repo is set with VITE_LOCAL_YO_MODEL (the browser-ready copy on Hugging Face).
import type { Draft } from './forms'

const MODEL = import.meta.env.VITE_LOCAL_YO_MODEL as string | undefined
let worker: Worker | null = null
let seq = 0

export const localEngineEnabled = Boolean(MODEL)

export function localDraft(text: string, onProgress?: (pct: number) => void): Promise<Draft> {
  const base = { engine: 'adelani-m2m100', madeIn: 'Nigeria (on this device)' }
  if (!MODEL) return Promise.resolve({ ...base, text: null, error: 'not configured' })
  worker ??= new Worker(new URL('./localTranslate.worker.ts', import.meta.url), { type: 'module' })
  const id = ++seq
  return new Promise((resolve) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data.id !== id) return
      if (e.data.progress !== undefined) return onProgress?.(e.data.progress)
      worker!.removeEventListener('message', onMsg)
      resolve(e.data.error ? { ...base, text: null, error: e.data.error } : { ...base, text: e.data.text })
    }
    worker!.addEventListener('message', onMsg)
    worker!.postMessage({ id, model: MODEL, text })
  })
}
