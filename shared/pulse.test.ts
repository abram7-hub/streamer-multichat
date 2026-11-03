import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isFreshMessage, PULSE_DURATION_MS } from './pulse'

describe('isFreshMessage', () => {
  it('pulses only messages that just arrived', () => {
    const now = 1_000_000
    expect(isFreshMessage(now, now)).toBe(true)
    expect(isFreshMessage(now - 300, now)).toBe(true) // typowe opóźnienie paczkowania
    expect(isFreshMessage(now - 200 - 16, now)).toBe(true) // Tryb niskiego zużycia: paczki co 200 ms
    expect(isFreshMessage(now - 2_500, now)).toBe(false) // np. ponowny montaż po zmianie filtra
    expect(isFreshMessage(now - 60_000, now)).toBe(false)
  })
})

function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('}', start))
}

function keyframes(css: string, name: string): string {
  const start = css.indexOf(`@keyframes ${name} {`)
  expect(start).toBeGreaterThanOrEqual(0)
  const next = css.slice(start + 1).search(/@keyframes|@media|\n\.[a-z]/)
  return css.slice(start, next === -1 ? undefined : start + 1 + next)
}

const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')
const propertiesIn = (css: string): Set<string> =>
  new Set([...withoutComments(css).matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]!))

/**
 * Statyczna kontrola CSS animacji (bez przeglądarki) - wspólny plik czatu głównego, nakładki OBS
 * i podglądu. Animacje mogą używać wyłącznie `transform` i `opacity` (kompozytor, bez przeliczania
 * układu), pulsowanie jest jednorazowe (2 s), a `prefers-reduced-motion` usuwa ruch.
 */
describe('chat-appearance.css animations', () => {
  const css = readFileSync(resolve(__dirname, '../src/renderer/styles/chat-appearance.css'), 'utf8').replace(/\r\n/g, '\n')

  it('pulse runs once for 2 s on an overlay pseudo-element in the platform accent colour', () => {
    const b = block(css, ".chat-list[data-effect='pulse-bounce'] .chat-row.fresh::after")
    expect(b).toMatch(/animation:\s*row-pulse\s+2s\s+[\w-]+\s+1;/)
    expect(PULSE_DURATION_MS).toBe(2000)
    expect(b).toMatch(/pointer-events:\s*none/)
    expect(b).toMatch(/opacity:\s*0;/)
    expect(b).toMatch(/var\(--row-accent/)
    expect(b).not.toMatch(/filter|backdrop|box-shadow|transform/)
  })

  it('pulse keyframes animate only opacity: brighten -> back -> second, weaker brighten -> 0', () => {
    const k = keyframes(css, 'row-pulse')
    expect(propertiesIn(k)).toEqual(new Set(['opacity']))
    expect([...k.matchAll(/opacity:\s*([\d.]+)/g)].map((m) => Number(m[1]))).toEqual([0, 1, 0.2, 0.6, 0])
  })

  it.each(['row-enter-left', 'row-enter-right', 'row-enter-bottom', 'row-enter-expand'])('%s uses only transform and opacity', (name) => {
    const props = propertiesIn(keyframes(css, name))
    expect(props).toEqual(new Set(['transform', 'opacity']))
  })

  it('bounce scales the row (1 -> up -> down -> 1) without changing width/height', () => {
    const k = keyframes(css, 'row-bounce')
    expect(propertiesIn(k)).toEqual(new Set(['transform']))
    expect([...k.matchAll(/transform:\s*(scale\([^)]*\)+)/g)].map((m) => m[1])).toEqual([
      'scale(1)',
      'scale(var(--bounce-up, 1.04))',
      'scale(var(--bounce-down, 0.99))',
      'scale(1)'
    ])
    expect(css).not.toMatch(/@keyframes[^{]*\{[^@]*\b(width|height|margin|padding|top|left)\s*:/)
  })

  it('bounce starts after the entry animation so both never fight over transform', () => {
    expect(block(css, ".chat-list:not([data-enter='none']) .chat-row.fresh")).toMatch(/--bounce-delay:\s*var\(--enter-duration/)
  })

  it('no blur, filters or animated shadows in any animation', () => {
    const animations = [...css.matchAll(/@keyframes[\s\S]*?\n\}/g)].map((m) => m[0]).join('\n')
    expect(animations).not.toMatch(/filter|blur|box-shadow|backdrop/)
  })

  it('prefers-reduced-motion: entry becomes a calm fade, bounce is dropped, pulse is a single fade', () => {
    const media = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(media).toMatch(/\.chat-row\.fresh\s*\{\s*animation:\s*none/)
    expect(media).toMatch(/row-enter-fade/)
    expect(media).toMatch(/row-pulse-reduced\s+2s/)
    expect(propertiesIn(keyframes(css, 'row-enter-fade'))).toEqual(new Set(['opacity']))
  })
})
