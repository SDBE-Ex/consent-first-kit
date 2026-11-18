// Runs the Nigerian-made Adelani English->Yoruba model inside the lead's browser.
// No server, no API key, and the text never leaves the device.
//
// Why a hand-written decode loop: our ONNX copy was exported WITHOUT a key/value cache
// (the cached export ran out of memory on free Colab). Transformers.js generate() assumes
// a cache and feeds the decoder only the newest token, so it stops at once with an empty
// result. Here we feed the whole sequence each step (greedy). Slower, but correct, and
// fine for short form lines. Verified in the browser: "Badly most nights" ->
// "Ó máa ń burú ní ọ̀pọ̀ ìgbà lóru" (same as the Colab test).
import * as hf from '@huggingface/transformers'

type OrtTensor = { dims: number[]; data: Float32Array }
type Session = { run: (feeds: Record<string, unknown>) => Promise<Record<string, OrtTensor>> }
type Model = { sessions: Record<string, Session> }
type Encoded = { input_ids: { ort_tensor: unknown }; attention_mask: { ort_tensor: unknown } }
type Tokenizer = ((text: string) => Encoded) & {
  decode: (ids: number[], o: { skip_special_tokens: boolean }) => string
  model: { tokens_to_ids: Map<string, number> }
}

const EOS = 2
const MAX_NEW_TOKENS = 120

let loaded: Promise<{ tok: Tokenizer; model: Model }> | null = null

function load(model: string, onProgress: (pct: number) => void) {
  const progress_callback = (p: { status: string; progress?: number }) => {
    if (p.status === 'progress') onProgress(Math.round(p.progress ?? 0))
  }
  return (async () => {
    const tok = (await hf.AutoTokenizer.from_pretrained(model, { progress_callback })) as unknown as Tokenizer
    const m = (await hf.AutoModelForSeq2SeqLM.from_pretrained(model, {
      dtype: 'q8', // quantized: ~4x smaller download, fine for drafts
      progress_callback,
    })) as unknown as Model
    return { tok, model: m }
  })()
}

async function translate(tok: Tokenizer, model: Model, text: string): Promise<string> {
  const yo = tok.model.tokens_to_ids.get('__yo__')
  if (yo === undefined) throw new Error('Yoruba language token missing from tokenizer')
  const enc = tok(text)
  const { last_hidden_state } = await model.sessions.model.run({
    input_ids: enc.input_ids.ort_tensor,
    attention_mask: enc.attention_mask.ort_tensor,
  })
  const decoder = model.sessions.decoder_model_merged
  const ids = [EOS, yo] // decoder start token, then the target language
  for (let step = 0; step < MAX_NEW_TOKENS; step++) {
    const input = new hf.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]) as unknown as {
      ort_tensor: unknown
    }
    const { logits } = await decoder.run({
      input_ids: input.ort_tensor,
      encoder_attention_mask: enc.attention_mask.ort_tensor,
      encoder_hidden_states: last_hidden_state,
    })
    const vocab = logits.dims[2]
    const offset = (ids.length - 1) * vocab
    let best = 0
    let bestScore = -Infinity
    for (let i = 0; i < vocab; i++) {
      const s = logits.data[offset + i]
      if (s > bestScore) {
        bestScore = s
        best = i
      }
    }
    ids.push(best)
    if (best === EOS) break
  }
  return tok.decode(ids, { skip_special_tokens: true }).trim()
}

// One line at a time: ONNX sessions cannot run two calls at once.
let queue: Promise<unknown> = Promise.resolve()

self.onmessage = (e: MessageEvent<{ id: number; model: string; text: string }>) => {
  const { id, model, text } = e.data
  queue = queue.then(async () => {
    try {
      loaded ??= load(model, (progress) => self.postMessage({ id, progress }))
      const { tok, model: m } = await loaded
      const out = await translate(tok, m, text)
      self.postMessage(out ? { id, text: out } : { id, error: 'the model returned an empty draft' })
    } catch (err) {
      loaded = null
      self.postMessage({ id, error: String(err) })
    }
  })
}
