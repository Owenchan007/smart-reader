import React, { useEffect } from 'react'
import { useStore } from './stores/useStore'
import Library from './components/Library/Library'
import ReaderView from './components/Reader/ReaderView'
import AppHeader from './components/AppHeader'

const App: React.FC = () => {
  const { view, setApiKey, setAiModel, setReaderSettings } = useStore()

  useEffect(() => {
    // Load saved settings on startup
    window.electronAPI.getSettings().then((settings) => {
      if (settings.apiKey) setApiKey(settings.apiKey)
      if (settings.aiModel) setAiModel(settings.aiModel)
      if (settings.fontSize) {
        setReaderSettings({ fontSize: parseInt(settings.fontSize) })
      }
      if (settings.fontFamily) {
        setReaderSettings({ fontFamily: settings.fontFamily })
      }
      if (settings.theme) {
        setReaderSettings({ theme: settings.theme as 'light' | 'warm' | 'dark' })
      }
    })
  }, [])

  return (
    <div className="app-container">
      <AppHeader />
      <div className="app-body">
        {view === 'library' ? <Library /> : <ReaderView />}
      </div>
    </div>
  )
}

export default App
