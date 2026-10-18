import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './education-design-tokens.css'
import App from './App.tsx'
import { initializeAccessTrace } from './lib/browserAccessTrace'

initializeAccessTrace()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
