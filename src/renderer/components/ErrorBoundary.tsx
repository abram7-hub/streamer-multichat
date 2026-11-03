import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | undefined
}

/** Łapie nieprzechwycone błędy renderowania, żeby zamiast pustego okna pokazać komunikat. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: undefined }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[renderer] nieprzechwycony błąd interfejsu:', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="init-error">
          <h2>Wystąpił błąd interfejsu</h2>
          <p>{this.state.error.message}</p>
          <p className="help-text">Szczegóły w konsoli DevTools (Ctrl+Shift+I) i w logu terminala.</p>
        </div>
      )
    }
    return this.props.children
  }
}
