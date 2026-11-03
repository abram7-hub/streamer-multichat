/**
 * Czy URL wolno otworzyć w systemowej przeglądarce (`shell.openExternal`). `openExternal` przekazuje
 * adres do powłoki systemu, więc schematy typu `file:`, `ms-settings:`, `search-ms:` czy własne
 * protokoły aplikacji mogłyby uruchomić lokalny program lub otworzyć plik. Dopuszczamy wyłącznie
 * `https:` - aplikacja nie otwiera żadnych stron po `http:` (strony logowania platform i linki
 * pomocy są po https). Dane logowania w URL (`user:pass@`) też są odrzucane.
 */
export function isSafeExternalUrl(url: string | undefined): url is string {
  if (!url) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return parsed.protocol === 'https:' && parsed.hostname !== '' && !parsed.username && !parsed.password
}
