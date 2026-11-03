import { describe, expect, it } from 'vitest'
import { isSafeExternalUrl } from './external-url'

describe('isSafeExternalUrl', () => {
  it('allows regular https pages', () => {
    expect(isSafeExternalUrl('https://www.twitch.tv/activate')).toBe(true)
    expect(isSafeExternalUrl('https://id.kick.com/oauth/authorize?client_id=x&state=y')).toBe(true)
    expect(isSafeExternalUrl('https://accounts.google.com/o/oauth2/v2/auth?scope=a%20b')).toBe(true)
    expect(isSafeExternalUrl('HTTPS://EXAMPLE.COM/path')).toBe(true)
  })

  it('rejects http and every non-https scheme', () => {
    for (const url of [
      'http://example.com/',
      'file:///C:/Windows/System32/calc.exe',
      'file://server/share/x.exe',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'shell:startup',
      'ms-settings:privacy',
      'search-ms:query=x',
      'ms-msdt:/id PCWDiagnostic',
      'mailto:someone@example.com',
      'customapp://open?x=1',
      'ftp://example.com/x'
    ]) {
      expect(isSafeExternalUrl(url), url).toBe(false)
    }
  })

  it('rejects malformed, empty and credential-bearing URLs', () => {
    expect(isSafeExternalUrl(undefined)).toBe(false)
    expect(isSafeExternalUrl('')).toBe(false)
    expect(isSafeExternalUrl('not a url')).toBe(false)
    expect(isSafeExternalUrl('//example.com/x')).toBe(false)
    expect(isSafeExternalUrl('https://user:pass@example.com/')).toBe(false)
    expect(isSafeExternalUrl('https://user@example.com/')).toBe(false)
  })
})
