import React, { ErrorInfo, ReactNode } from 'react'

type AppErrorBoundaryProps = {
  children: ReactNode
}

type AppErrorBoundaryState = {
  error: Error | null
}

export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  constructor(props: AppErrorBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('App render crash caught by ErrorBoundary', error, info)
  }

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children
    }

    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#020617',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 680,
            borderRadius: 12,
            border: '1px solid rgba(239, 68, 68, 0.3)',
            background: '#0f172a',
            color: '#fecaca',
            padding: 20
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: 10, fontSize: 20, color: '#fca5a5' }}>Garuda Desktop hit an error</h2>
          <p style={{ margin: 0, marginBottom: 12, color: '#fecaca', lineHeight: 1.45 }}>
            The app caught a runtime render exception and stopped this screen to avoid a blank view.
          </p>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: 0,
              marginBottom: 14,
              borderRadius: 8,
              border: '1px solid #334155',
              background: '#020617',
              color: '#e2e8f0',
              padding: 10,
              fontSize: 12
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              border: 'none',
              borderRadius: 8,
              background: '#2563eb',
              color: 'white',
              fontWeight: 600,
              padding: '8px 12px',
              cursor: 'pointer'
            }}
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
