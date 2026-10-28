export interface Segment {
  text: string
  color?: string
  bold?: boolean
  dim?: boolean
}

// Muted terminal palette: legible on both themes without looking neon.
const BASIC = ['#6b6b73', '#e5675f', '#55c08b', '#d9a441', '#6a9ef0', '#b48ae8', '#4fb8c6', '#c9c9cf']
const BRIGHT = ['#8a8a93', '#f07f78', '#6fd4a1', '#e8bb5c', '#8ab4f8', '#c7a2f2', '#6fd0dc', 'var(--fg)']

function xterm256(n: number): string | undefined {
  if (n < 8) return BASIC[n]
  if (n < 16) return BRIGHT[n - 8]
  if (n < 232) {
    const i = n - 16
    const c = [Math.floor(i / 36), Math.floor((i % 36) / 6), i % 6].map((v) => (v ? v * 40 + 55 : 0))
    return `rgb(${c[0]} ${c[1]} ${c[2]})`
  }
  const g = (n - 232) * 10 + 8
  return `rgb(${g} ${g} ${g})`
}

// FXServer prints both ANSI escapes and Cfx caret colours (^1 .. ^9).
const CARET: Record<string, string | undefined> = {
  '0': undefined,
  '1': BRIGHT[1],
  '2': BRIGHT[2],
  '3': BRIGHT[3],
  '4': BRIGHT[4],
  '5': BRIGHT[6],
  '6': BRIGHT[5],
  '7': undefined,
  '8': BASIC[1],
  '9': BASIC[5]
}

const TOKEN = /\x1b\[([\d;]*)m|\^(\d)/g

export function parseAnsi(input: string): Segment[] {
  const out: Segment[] = []
  let color: string | undefined
  let bold = false
  let dim = false
  let last = 0
  let m: RegExpExecArray | null
  TOKEN.lastIndex = 0
  while ((m = TOKEN.exec(input))) {
    if (m.index > last) out.push({ text: input.slice(last, m.index), color, bold, dim })
    last = TOKEN.lastIndex
    if (m[2] !== undefined) {
      color = CARET[m[2]]
      continue
    }
    const codes = (m[1] || '0').split(';').map(Number)
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]
      if (c === 0) {
        color = undefined
        bold = false
        dim = false
      } else if (c === 1) bold = true
      else if (c === 2) dim = true
      else if (c === 22) {
        bold = false
        dim = false
      } else if (c >= 30 && c <= 37) color = BASIC[c - 30]
      else if (c >= 90 && c <= 97) color = BRIGHT[c - 90]
      else if (c === 39) color = undefined
      else if (c === 38 && codes[i + 1] === 5) {
        color = xterm256(codes[i + 2])
        i += 2
      } else if (c === 38 && codes[i + 1] === 2) {
        color = `rgb(${codes[i + 2]} ${codes[i + 3]} ${codes[i + 4]})`
        i += 4
      }
    }
  }
  if (last < input.length) out.push({ text: input.slice(last), color, bold, dim })
  return out
}

export function stripAnsi(input: string): string {
  return input.replace(TOKEN, '')
}
