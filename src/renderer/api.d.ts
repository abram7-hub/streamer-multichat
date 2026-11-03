import type { IpcEventMap, IpcInvokeMap } from '@shared/ipc'

type Async<F> = F extends (...args: infer A) => infer R ? (...args: A) => Promise<R> : never

export interface MultichatRendererApi {
  getSettings: Async<IpcInvokeMap['settings:get']>
  updateSettings: Async<IpcInvokeMap['settings:update']>
  testConnection: Async<IpcInvokeMap['platform:test-connection']>
  connectPlatform: Async<IpcInvokeMap['platform:connect']>
  disconnectPlatform: Async<IpcInvokeMap['platform:disconnect']>
  oauthStart: Async<IpcInvokeMap['oauth:start']>
  oauthLogout: Async<IpcInvokeMap['oauth:logout']>
  kickTunnelStart: Async<IpcInvokeMap['kick:tunnel-start']>
  kickTunnelStop: Async<IpcInvokeMap['kick:tunnel-stop']>
  kickTunnelStatus: Async<IpcInvokeMap['kick:tunnel-status']>
  getVersion: Async<IpcInvokeMap['app:get-version']>
  setDemoEnabled: Async<IpcInvokeMap['demo:set-enabled']>
  setSecret: Async<IpcInvokeMap['secrets:set']>
  hasSecret: Async<IpcInvokeMap['secrets:has']>
  getStatuses: Async<IpcInvokeMap['status:get-all']>
  gamingGetState: Async<IpcInvokeMap['gaming:get-state']>
  gamingSetMode: Async<IpcInvokeMap['gaming:set-mode']>
  gamingResizeBy: Async<IpcInvokeMap['gaming:resize-by']>
  gamingResetPosition: Async<IpcInvokeMap['gaming:reset-position']>
  gamingShow: Async<IpcInvokeMap['gaming:show']>
  exportVisualSettings: Async<IpcInvokeMap['visual:export']>
  importVisualSettings: Async<IpcInvokeMap['visual:import']>

  onChatMessage: (listener: (payload: IpcEventMap['chat:message']) => void) => () => void
  onChatClear: (listener: (payload: IpcEventMap['chat:clear']) => void) => () => void
  onStatusUpdate: (listener: (payload: IpcEventMap['status:update']) => void) => () => void
  onGamingState: (listener: (payload: IpcEventMap['gaming:state']) => void) => () => void
  onSettingsChanged: (listener: (payload: IpcEventMap['settings:changed']) => void) => () => void
  onActivityEvent: (listener: (payload: IpcEventMap['activity:event']) => void) => () => void
  onWatchedChannelStatus: (listener: (payload: IpcEventMap['watched-channel:status']) => void) => () => void
  onDeviceCodePrompt: (listener: (payload: IpcEventMap['oauth:device-code']) => void) => () => void
  onKickTunnelStatusChanged: (listener: (payload: IpcEventMap['kick:tunnel-status-changed']) => void) => () => void
}

declare global {
  interface Window {
    api: MultichatRendererApi
  }
}
