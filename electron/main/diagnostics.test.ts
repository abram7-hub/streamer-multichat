import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DiagnosticsLog, formatDiagnostic } from './diagnostics'

const dirs: string[] = []
function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'diag-test-'))
  dirs.push(dir)
  return join(dir, 'logs', 'diagnostics.log')
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('formatDiagnostic', () => {
  it('writes timestamp, event and only the given technical fields', () => {
    const line = formatDiagnostic(
      'child-process-gone',
      { type: 'Utility', serviceName: 'network.mojom.NetworkService', reason: 'crashed', exitCode: -1073741819, name: undefined },
      new Date('2026-10-17T12:00:00.000Z')
    )
    expect(line).toBe('2026-10-17T12:00:00.000Z child-process-gone type=Utility serviceName=network.mojom.NetworkService reason=crashed exitCode=-1073741819')
  })

  it('keeps every entry on one line and shortens long values', () => {
    const line = formatDiagnostic('did-fail-load', { description: 'line one\nline two', long: 'x'.repeat(500) }, new Date(0))
    expect(line.split('\n')).toHaveLength(1)
    expect(line).toContain('description=line_one_line_two')
    expect(line.length).toBeLessThan(200)
  })
})

describe('DiagnosticsLog', () => {
  it('appends lines to the log file', async () => {
    const file = tempFile()
    const echoed: string[] = []
    const log = new DiagnosticsLog(() => file, () => new Date('2026-10-17T12:00:00.000Z'), (l) => echoed.push(l))
    log.record('render-process-gone', { reason: 'crashed', exitCode: 1 })
    log.record('responsive')
    await log.flush()
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toEqual([
      '2026-10-17T12:00:00.000Z render-process-gone reason=crashed exitCode=1',
      '2026-10-17T12:00:00.000Z responsive'
    ])
    expect(echoed).toHaveLength(2)
  })

  it('limits the number of entries per minute and reports how many were suppressed', async () => {
    const file = tempFile()
    let now = new Date('2026-10-17T12:00:00.000Z').getTime()
    const log = new DiagnosticsLog(() => file, () => new Date(now), () => undefined)
    for (let i = 0; i < 50; i++) log.record('child-process-gone', { type: 'GPU', reason: 'crashed' })
    now += 61_000
    log.record('responsive')
    await log.flush()
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines.filter((l) => l.includes('child-process-gone'))).toHaveLength(20)
    expect(lines).toContain('2026-10-17T12:01:01.000Z diagnostics-suppressed count=30')
    expect(lines.at(-1)).toContain('responsive')
  })

  it('rotates the file once it exceeds the size limit', async () => {
    const file = tempFile()
    const log = new DiagnosticsLog(() => file, () => new Date(0), () => undefined)
    log.record('first')
    await log.flush()
    writeFileSync(file, 'x'.repeat(300 * 1024))
    log.record('after-rotation')
    await log.flush()
    expect(existsSync(`${file}.1`)).toBe(true)
    expect(statSync(file).size).toBeLessThan(1024)
    expect(readFileSync(file, 'utf8')).toContain('after-rotation')
  })

  it('never throws when the log location is not writable', async () => {
    const file = tempFile()
    writeFileSync(join(file, '..', '..', 'logs'), 'not a directory')
    const log = new DiagnosticsLog(() => file, () => new Date(0), () => undefined)
    expect(() => log.record('render-process-gone')).not.toThrow()
    await expect(log.flush()).resolves.toBeUndefined()
  })
})
