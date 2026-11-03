import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles/global.css'
import './styles/chat-appearance.css'
import './styles/settings.css'

window.addEventListener('error', (event) => {
  console.error('[renderer] globalny błąd:', event.error ?? event.message)
})
window.addEventListener('unhandledrejection', (event) => {
  console.error('[renderer] nieobsłużone odrzucenie obietnicy:', event.reason)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
