// Runs the Nigerian-made Adelani English->Yoruba model inside the lead's browser.
// No server, no API key, and the text never leaves the device.
import * as hf from '@huggingface/transformers'

type Translate = (text: string, opts: { src_lang: string; tgt_lang: string }) => Promise<{ translation_text: string }[]>
// Typed loosely on purpose: the library's pipeline() overloads are too large for the TS compiler.
const pipeline = hf.pipeline as unknown as (task: string, model: string, opts: object) => Promise<Translate>

let translator: Promise<Translate> | null = null

self.onmessage = async (e: MessageEvent<{ id: number; model: string; text: string }>) => {
  const { id, model, text } = e.data
  try {
    translator ??= pipeline('translation', model, {
      dtype: 'q8', // quantized: ~4x smaller download, fine for drafts
      progress_callback: (p: { status: string; progress?: number }) => {
        if (p.status === 'progress') self.postMessage({ id, progress: Math.round(p.progress ?? 0) })
      },
    })
    const t = await translator
    const out = await t(text, { src_lang: 'en', tgt_lang: 'yo' })
    self.postMessage({ id, text: out[0]?.translation_text ?? '' })
  } catch (err) {
    translator = null
    self.postMessage({ id, error: String(err) })
  }
}
