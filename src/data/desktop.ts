interface TauriApi {
  core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> }
  window: {
    getCurrentWindow(): {
      destroy(): Promise<void>
      onCloseRequested(handler: (event: { preventDefault(): void }) => void): Promise<() => void>
    }
  }
}

const api = (window as Window & { __TAURI__?: TauriApi }).__TAURI__
export const isDesktop = Boolean(api)

export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!api) return Promise.reject(new Error('Open FlowArchitect in the desktop app to use local files.'))
  return api.core.invoke<T>(command, args)
}

export function onDesktopClose(handler: (event: { preventDefault(): void }) => void) {
  return api?.window.getCurrentWindow().onCloseRequested(handler)
}

export function closeDesktopWindow() {
  return api?.window.getCurrentWindow().destroy()
}
