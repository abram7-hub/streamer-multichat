import { MentionSoundThrottle, type MentionSoundSettings } from '@shared/mentions'

/**
 * Dźwięk wzmianki: domyślnie krótki, cichy dwutonowy sygnał z Web Audio (bez pliku), albo własny
 * plik zapisany w ustawieniach jako data URL. Przepustnica pilnuje odstępu między dźwiękami,
 * więc seria wzmianek (spam) daje jeden dźwięk na `cooldownSec`.
 */
const throttle = new MentionSoundThrottle()
let context: AudioContext | undefined

function playTone(volume: number): void {
  context ??= new AudioContext()
  const ctx = context
  const start = ctx.currentTime
  const gain = ctx.createGain()
  gain.connect(ctx.destination)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.25 * volume), start + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32)
  for (const [freq, at] of [
    [880, 0],
    [1320, 0.09]
  ] as const) {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, start + at)
    osc.connect(gain)
    osc.start(start + at)
    osc.stop(start + 0.34)
  }
}

export function playMentionSound(sound: MentionSoundSettings): void {
  const volume = sound.volume / 100
  if (volume <= 0) return
  try {
    if (sound.customData) {
      const audio = new Audio(sound.customData)
      audio.volume = volume
      void audio.play().catch(() => playTone(volume))
    } else {
      playTone(volume)
    }
  } catch {
    // Brak urządzenia audio - wzmianka i tak jest wyróżniona w czacie.
  }
}

/** Dla nowej paczki wiadomości: najwyżej jeden dźwięk, z zachowaniem odstępu. */
export function maybePlayMentionSound(sound: MentionSoundSettings | undefined, hasMention: boolean): void {
  if (!sound?.enabled || !hasMention) return
  if (!throttle.tryPlay(sound.cooldownSec * 1000)) return
  playMentionSound(sound)
}
