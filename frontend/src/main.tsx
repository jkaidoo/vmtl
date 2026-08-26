import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './context/AuthContext'
import { MetaProvider } from './context/MetaContext'
import { ToastProvider } from './components/Toast'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <MetaProvider>
            <App />
          </MetaProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
)

// Remove the boot splash once the app has mounted (with fallbacks).
function removeSplash() {
  const el = document.getElementById('app-splash')
  if (!el) return
  el.style.opacity = '0'
  setTimeout(() => el.remove(), 260)
}
requestAnimationFrame(() => requestAnimationFrame(removeSplash))
window.addEventListener('load', removeSplash)
setTimeout(removeSplash, 8000)
