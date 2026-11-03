/** Wiadomość uznajemy za "nową" (pulsuje), jeśli trafia na ekran do 1,5 s od odebrania - dzięki
 *  temu wiersze ponownie montowane (np. po włączeniu filtra platformy) nie pulsują drugi raz. */
export const FRESH_WINDOW_MS = 1500
/** Czas trwania pulsowania - musi zgadzać się z `animation-duration` w CSS (.pulse::after). */
export const PULSE_DURATION_MS = 2000

export function isFreshMessage(receivedAtMs: number, now = Date.now()): boolean {
  const age = now - receivedAtMs
  return age >= -FRESH_WINDOW_MS && age < FRESH_WINDOW_MS
}
