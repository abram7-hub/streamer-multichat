import { contextBridge, ipcRenderer } from 'electron'
import type { IpcEventChannel, IpcInvokeChannel, IpcInvokeMap, IpcEventMap } from '../../shared/ipc'

function invoke<C extends IpcInvokeChannel>(
  channel: C,
  ...args: Parameters<IpcInvokeMap[C]>
): Promise<ReturnType<IpcInvokeMap[C]>> {
  return ipcRenderer.invoke(channel, ...args)
}

function on<C extends IpcEventChannel>(channel: C, listener: (payload: IpcEventMap[C]) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: IpcEventMap[C]): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api = {
  getSettings: () => invoke('settings:get'),
  updateSettings: (patch: Parameters<IpcInvokeMap['settings:update']>[0]) => invoke('settings:update', patch),
  testConnection: (platform: Parameters<IpcInvokeMap['platform:test-connection']>[0]) =>
    invoke('platform:test-connection', platform),
  connectPlatform: (platform: Parameters<IpcInvokeMap['platform:connect']>[0]) => invoke('platform:connect', platform),
  disconnectPlatform: (platform: Parameters<IpcInvokeMap['platform:disconnect']>[0]) =>
    invoke('platform:disconnect', platform),
  oauthStart: (platform: Parameters<IpcInvokeMap['oauth:start']>[0]) => invoke('oauth:start', platform),
  oauthLogout: (platform: Parameters<IpcInvokeMap['oauth:logout']>[0]) => invoke('oauth:logout', platform),
  kickTunnelStart: () => invoke('kick:tunnel-start'),
  kickTunnelStop: () => invoke('kick:tunnel-stop'),
  kickTunnelStatus: () => invoke('kick:tunnel-status'),
  getVersion: () => invoke('app:get-version'),
  setDemoEnabled: (enabled: boolean) => invoke('demo:set-enabled', enabled),
  setSecret: (input: Parameters<IpcInvokeMap['secrets:set']>[0]) => invoke('secrets:set', input),
  hasSecret: (key: Parameters<IpcInvokeMap['secrets:has']>[0]) => invoke('secrets:has', key),
  getStatuses: () => invoke('status:get-all'),
  gamingGetState: () => invoke('gaming:get-state'),
  gamingSetMode: (mode: Parameters<IpcInvokeMap['gaming:set-mode']>[0]) => invoke('gaming:set-mode', mode),
  gamingResizeBy: (delta: Parameters<IpcInvokeMap['gaming:resize-by']>[0]) => invoke('gaming:resize-by', delta),
  gamingResetPosition: () => invoke('gaming:reset-position'),
  gamingShow: () => invoke('gaming:show'),
  exportVisualSettings: () => invoke('visual:export'),
  importVisualSettings: () => invoke('visual:import'),

  onChatMessage: (listener: (payload: IpcEventMap['chat:message']) => void) => on('chat:message', listener),
  onChatClear: (listener: (payload: IpcEventMap['chat:clear']) => void) => on('chat:clear', listener),
  onStatusUpdate: (listener: (payload: IpcEventMap['status:update']) => void) => on('status:update', listener),
  onActivityEvent: (listener: (payload: IpcEventMap['activity:event']) => void) => on('activity:event', listener),
  onWatchedChannelStatus: (listener: (payload: IpcEventMap['watched-channel:status']) => void) =>
    on('watched-channel:status', listener),
  onDeviceCodePrompt: (listener: (payload: IpcEventMap['oauth:device-code']) => void) =>
    on('oauth:device-code', listener),
  onGamingState: (listener: (payload: IpcEventMap['gaming:state']) => void) => on('gaming:state', listener),
  onSettingsChanged: (listener: (payload: IpcEventMap['settings:changed']) => void) => on('settings:changed', listener),
  onKickTunnelStatusChanged: (listener: (payload: IpcEventMap['kick:tunnel-status-changed']) => void) =>
    on('kick:tunnel-status-changed', listener)
}

export type MultichatApi = typeof api

contextBridge.exposeInMainWorld('api', api)
