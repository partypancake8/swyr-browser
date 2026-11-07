import { createRoot } from 'react-dom/client'
import '../common/base.css'
import './overlay.css'
import { startViewSync } from '../common/store'
import { App } from './App'

startViewSync()
createRoot(document.getElementById('root')!).render(<App />)
