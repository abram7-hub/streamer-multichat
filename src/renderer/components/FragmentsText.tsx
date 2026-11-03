import { memo, useState } from 'react'
import type { MessageFragment } from '@shared/chat-message'
import { isAllowedEmoteUrl, isSafeHttpUrl } from '@shared/emote-url'

type EmoteFragment = Extract<MessageFragment, { type: 'emote' }>

/** Emotka znanego providera musi pochodzić z jego CDN; emotki innych platform (Kick/YouTube/TikTok)
 *  - przynajmniej z http(s). Inaczej pokazujemy zwykły tekst. */
function emoteUrlOk(fragment: EmoteFragment): boolean {
  return fragment.provider ? isAllowedEmoteUrl(fragment.url, fragment.provider) : isSafeHttpUrl(fragment.url)
}

/** Szerokość z proporcji providera - rezerwuje miejsce przed załadowaniem (brak skakania wiersza). */
function emoteStyle(ratio: number | undefined): { width: string } | undefined {
  return ratio && ratio > 0 && ratio < 8 ? { width: `${(1.6 * ratio).toFixed(3)}em` } : undefined
}

/**
 * Pojedyncza emotka z fallbackiem: jeśli obrazka nie da się pobrać (404, CDN niedostępny, offline),
 * w jego miejscu zostaje zwykły tekst kodu emotki zamiast ikony zepsutego obrazka.
 */
function Emote({ fragment }: { fragment: EmoteFragment }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span>{fragment.text}</span>
  // Nakładki zero-width pochodzą wyłącznie z 7TV.
  const overlays = fragment.overlays?.filter((o) => isAllowedEmoteUrl(o.url, '7tv')) ?? []
  const label = fragment.provider && fragment.provider !== 'twitch' ? `${fragment.text} (${fragment.provider.toUpperCase()})` : fragment.text
  const img = (
    <img
      className="emote-img"
      src={fragment.url}
      alt={fragment.text}
      title={overlays.length > 0 ? undefined : label}
      style={emoteStyle(fragment.ratio)}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
  if (overlays.length === 0) return img
  return (
    <span className="emote-wrap" title={[fragment.text, ...overlays.map((o) => o.text)].join(' + ')}>
      {img}
      {overlays.map((overlay, i) => (
        <img key={i} className="emote-img emote-overlay" src={overlay.url} alt={overlay.text} loading="lazy" decoding="async" />
      ))}
    </span>
  )
}

/**
 * Renderuje fragmenty wiadomości bezpiecznie - wyłącznie przez React (bez innerHTML), a URL-e
 * obrazków/linków są sprawdzane przed użyciem. `memo`: fragmenty wiadomości są niezmienne, więc
 * raz wyrenderowana treść (z animowanymi emotkami) nie jest ponownie przeliczana przez Reacta -
 * animacja GIF/WEBP odbywa się w całości w dekoderze obrazów przeglądarki, bez re-renderów.
 */
export const FragmentsText = memo(function FragmentsText({ fragments }: { fragments: MessageFragment[] }) {
  return (
    <span className="message-text">
      {fragments.map((fragment, index) => {
        if (fragment.type === 'emote') {
          if (!emoteUrlOk(fragment)) return <span key={index}>{fragment.text}</span>
          return <Emote key={index} fragment={fragment} />
        }
        if (fragment.type === 'link') {
          if (!isSafeHttpUrl(fragment.url)) return <span key={index}>{fragment.text}</span>
          return (
            <a key={index} className="message-link" href={fragment.url} target="_blank" rel="noreferrer noopener">
              {fragment.text}
            </a>
          )
        }
        return <span key={index}>{fragment.text}</span>
      })}
    </span>
  )
})
