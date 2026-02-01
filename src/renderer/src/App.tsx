import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { LoginForm } from './components/LoginForm'
import { Session } from '@supabase/supabase-js'
import { LogOut, FolderOpen, Scan } from 'lucide-react'

/* ---------- TYPES ---------- */

type ScannedFile = {
  name: string
  path: string
  size: number
  extension: string
}

type ScanResult =
  | { success: true; count: number; files: ScannedFile[] }
  | { success: false; error: string }

/* ---------- APP ---------- */

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  const [folderPath, setFolderPath] = useState<string | null>(null)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [scanning, setScanning] = useState(false)

  /* ---------- AUTH ---------- */

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div style={{ height: '100vh', background: '#020617', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
        Loading...
      </div>
    )
  }

  /* ---------- LOGIN ---------- */

  if (!session) {
    return (
      <div style={{ height: '100vh', background: '#020617', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: '400px', padding: '40px', background: '#0f172a', borderRadius: '16px', border: '1px solid #1e293b' }}>
          <div style={{ marginBottom: '32px', textAlign: 'center' }}>
            <h1 style={{ color: 'white', fontSize: '24px', fontWeight: 'bold', marginBottom: '8px' }}>
              Garuda Desktop
            </h1>
            <p style={{ color: '#94a3b8', fontSize: '14px' }}>
              Sign in with your Mindframes account
            </p>
          </div>
          <LoginForm />
        </div>
      </div>
    )
  }

  /* ---------- ACTIONS ---------- */

  const handleSelectFolder = async () => {
    const path = await window.api.selectFolder()
    setFolderPath(path)
    setScanResult(null)
  }

  const handleScan = async () => {
    if (!folderPath) return
    setScanning(true)
    const result = await window.api.scanFolder(folderPath)
    setScanResult(result)
    setScanning(false)
  }

  /* ---------- DASHBOARD ---------- */

  return (
    <div style={{ minHeight: '100vh', background: '#020617', color: 'white', display: 'flex' }}>
      {/* Sidebar */}
      <div style={{ width: '250px', borderRight: '1px solid #1e293b', padding: '20px', display: 'flex', flexDirection: 'column' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '32px', color: '#38bdf8' }}>
          GARUDA
        </h2>

        <div style={{ flex: 1 }} />

        <div style={{ borderTop: '1px solid #1e293b', paddingTop: '20px' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '12px' }}>
            {session.user.email}
          </div>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'none',
              border: 'none',
              color: '#ef4444',
              cursor: 'pointer',
              fontSize: '13px',
              padding: 0,
            }}
          >
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, padding: '40px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '10px' }}>
          Upload Dashboard
        </h1>
        <p style={{ color: '#94a3b8', marginBottom: '30px' }}>
          Scan folders before upload
        </p>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
          <button
            onClick={handleSelectFolder}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid #1e293b',
              background: '#0f172a',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            <FolderOpen size={16} />
            Select Folder
          </button>

          <button
            onClick={handleScan}
            disabled={!folderPath || scanning}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 14px',
              borderRadius: '8px',
              border: 'none',
              background: scanning ? '#334155' : '#10b981',
              color: 'white',
              cursor: scanning ? 'not-allowed' : 'pointer',
            }}
          >
            <Scan size={16} />
            {scanning ? 'Scanning…' : 'Scan Folder'}
          </button>
        </div>

        {/* Path */}
        {folderPath && (
          <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '20px' }}>
            Selected: {folderPath}
          </div>
        )}

        {/* Results */}
        {scanResult && scanResult.success && (
          <div style={{ background: '#0f172a', padding: '20px', borderRadius: '12px' }}>
            <strong>{scanResult.count} files found</strong>

            <div style={{ marginTop: '10px', maxHeight: '240px', overflowY: 'auto' }}>
              {scanResult.files.slice(0, 25).map((file, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: '13px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '4px 0',
                    borderBottom: '1px solid #1e293b',
                    opacity: 0.9,
                  }}
                >
                  <span>{file.name}</span>
                  <span style={{ color: '#64748b' }}>
                    {(file.size / 1024 / 1024).toFixed(2)} MB · {file.extension}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {scanResult && !scanResult.success && (
          <div style={{ color: '#ef4444' }}>
            Error: {scanResult.error}
          </div>
        )}
      </div>
    </div>
  )
}

export default App