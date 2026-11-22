// Kept out of session.tsx so that file exports only components (fast refresh).
/** Short, readable code the person keeps (no 0/O/1/I). */
export function newCheckCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  const s = Array.from(bytes, (b) => chars[b % chars.length]).join('')
  return `${s.slice(0, 4)}-${s.slice(4)}`
}
