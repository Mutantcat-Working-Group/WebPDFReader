import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './polyfills/url-parse'
import App from './App.tsx'
import 'core-js/stable/promise/with-resolvers';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
