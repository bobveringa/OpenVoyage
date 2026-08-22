import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { bootstrapNativeApiBaseUrl } from './native/server-config'

// Must resolve before the app's first authenticated request: on native,
// this applies a stored server-URL override (the webview's own origin is
// never the API). No-op on web.
void bootstrapNativeApiBaseUrl().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
