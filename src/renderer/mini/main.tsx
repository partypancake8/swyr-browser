import { createRoot } from 'react-dom/client'
import '../common/base.css'
import { MiniApp } from './MiniApp'

createRoot(document.getElementById('root')!).render(<MiniApp />)
