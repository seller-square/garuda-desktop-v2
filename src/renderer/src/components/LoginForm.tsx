import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Loader2 } from 'lucide-react' // Make sure you installed lucide-react

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    }
    // Success is handled by the onAuthStateChange listener in App.tsx
  }

  return (
    <div style={{ width: '100%', maxWidth: '320px' }}>
      <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        
        {/* Email Input */}
        <div>
          <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>
            Email Address
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: '6px',
              border: '1px solid #334155',
              background: '#0f172a',
              color: 'white',
              fontSize: '14px',
              outline: 'none'
            }}
            placeholder="name@mindframes.media"
          />
        </div>

        {/* Password Input */}
        <div>
          <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>
            Password
          </label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: '6px',
              border: '1px solid #334155',
              background: '#0f172a',
              color: 'white',
              fontSize: '14px',
              outline: 'none'
            }}
            placeholder="••••••••"
          />
        </div>

        {/* Error Message */}
        {error && (
          <div style={{ 
            padding: '10px', 
            borderRadius: '6px', 
            background: 'rgba(239, 68, 68, 0.1)', 
            border: '1px solid rgba(239, 68, 68, 0.2)',
            color: '#ef4444',
            fontSize: '13px'
          }}>
            {error}
          </div>
        )}

        {/* Login Button */}
        <button
          type="submit"
          disabled={loading}
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '8px',
            padding: '10px',
            borderRadius: '6px',
            border: 'none',
            background: '#2563eb', // Blue-600
            color: 'white',
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
            marginTop: '8px'
          }}
        >
          {loading && <Loader2 size={16} className="animate-spin" />}
          {loading ? 'Signing in...' : 'Sign In'}
        </button>

      </form>
    </div>
  )
}