import type { Platform } from './platform'

/**
 * Bazowe kolory półprzezroczystego tła wiadomości per platforma (wymaganie: delikatny fiolet dla
 * Twitcha, delikatna zieleń dla Kicka, delikatna czerwień dla YouTube, neutralna szarość dla
 * TikToka). Celowo OSOBNA mapa od `PLATFORM_COLORS` (używanej do ikon) - TikTok ma inny kolor tła
 * (neutralna szarość) niż swój kolor marki (cyjan), żeby tło nie rywalizowało z kolorami nicków.
 */
export const MESSAGE_BACKGROUND_BASE_COLORS: Record<Platform, string> = {
  twitch: '#9146FF',
  kick: '#53FC18',
  youtube: '#FF0000',
  tiktok: '#8A8A8E'
}

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return [r, g, b]
}

/** Zwraca `rgba(r, g, b, a)` dla tła wiadomości danej platformy, przy podanej intensywności 0-100. */
export function platformMessageBackground(platform: Platform, intensityPercent: number): string {
  const [r, g, b] = hexToRgb(MESSAGE_BACKGROUND_BASE_COLORS[platform])
  const alpha = Math.max(0, Math.min(100, intensityPercent)) / 100
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`
}
