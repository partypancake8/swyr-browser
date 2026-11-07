// Small fuzzy matcher for the command bar: every query word must match as a substring or subsequence.

function wordScore(text: string, word: string): number {
  const idx = text.indexOf(word)
  if (idx >= 0) return 100 - Math.min(60, idx) + (idx === 0 || /[\s./:-]/.test(text[idx - 1]) ? 20 : 0)
  let ti = 0
  let gaps = 0
  for (const ch of word) {
    const found = text.indexOf(ch, ti)
    if (found < 0) return 0
    gaps += found - ti
    ti = found + 1
  }
  return Math.max(1, 40 - gaps)
}

export function fuzzyScore(query: string, ...fields: string[]): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1
  const text = fields.join(' ').toLowerCase()
  let total = 0
  for (const word of q.split(/\s+/)) {
    const s = wordScore(text, word)
    if (!s) return 0
    total += s
  }
  return total
}
