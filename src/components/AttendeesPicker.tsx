'use client'

import { useState, useEffect, useRef } from 'react'

interface User {
  id: string
  full_name: string | null
  email: string
}

interface AttendeesPickerProps {
  defaultAttendees: User[]
}

export function AttendeesPicker({ defaultAttendees }: AttendeesPickerProps) {
  const [selected, setSelected] = useState<User[]>(defaultAttendees)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectedRef = useRef<User[]>(selected)
  const containerRef = useRef<HTMLDivElement>(null)

  // Auto-focus if no defaults
  useEffect(() => {
    if (defaultAttendees.length === 0) inputRef.current?.focus()
  }, [defaultAttendees.length])

  // Keep selectedRef in sync without triggering the search effect
  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  // Close dropdown on outside click
  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setResults([])
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  // Debounced search
  useEffect(() => {
    if (query.length < 3) {
      setResults([])
      return
    }
    const timer = setTimeout(async () => {
      try {
        setLoading(true)
        const exclude = selectedRef.current.map(u => u.id).join(',')
        const res = await fetch(
          `/api/users/search?q=${encodeURIComponent(query)}&exclude=${encodeURIComponent(exclude)}`
        )
        if (!res.ok) { setResults([]); return }
        const data = await res.json()
        setResults((data.users ?? []).slice(0, 10))
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  function addUser(u: User) {
    setSelected(prev => [...prev, u])
    setResults([])
    setQuery('')
    inputRef.current?.focus()
  }

  function removeUser(id: string) {
    setSelected(prev => prev.filter(u => u.id !== id))
  }

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {/* Hidden inputs for server action */}
      {selected.map(u => (
        <input key={u.id} type="hidden" name="attendee_ids[]" value={u.id} />
      ))}

      {/* Chips */}
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
          {selected.map(u => (
            <span
              key={u.id}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                padding: '0.25rem 0.625rem', backgroundColor: '#f3f4f6',
                border: '1px solid #d1d5db', borderRadius: '999px',
                fontSize: '0.8125rem', color: '#111827',
              }}
            >
              {u.full_name ?? u.email}
              <button
                type="button"
                onClick={() => removeUser(u.id)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '0', lineHeight: 1, color: '#6b7280', fontSize: '1rem',
                }}
                aria-label={`Remove ${u.full_name ?? u.email}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { setResults([]); setQuery('') } }}
          placeholder={selected.length === 0 ? 'Type a name to search…' : 'Add another person…'}
          style={{
            width: '100%', padding: '0.5rem', border: '1px solid #d1d5db',
            borderRadius: '4px', fontSize: '0.875rem', boxSizing: 'border-box',
          }}
        />

        {/* Dropdown results */}
        {(results.length > 0 || loading) && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
            backgroundColor: 'white', border: '1px solid #d1d5db',
            borderTop: 'none', borderRadius: '0 0 4px 4px',
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
          }}>
            {loading && (
              <div style={{ padding: '0.5rem 0.75rem', fontSize: '0.8125rem', color: '#9ca3af' }}>
                Searching…
              </div>
            )}
            {results.map(u => (
              <button
                key={u.id}
                type="button"
                onClick={() => addUser(u)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '0.5rem 0.75rem', background: 'none', border: 'none',
                  cursor: 'pointer', fontSize: '0.875rem', color: '#111827',
                }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f9fafb')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                {u.full_name ?? u.email}
                {u.full_name && (
                  <span style={{ color: '#9ca3af', marginLeft: '0.5rem', fontSize: '0.8125rem' }}>
                    {u.email}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {selected.length === 0 && query.length < 3 && (
        <p style={{ margin: 0, fontSize: '0.8125rem', color: '#9ca3af' }}>
          Type at least 3 characters to search all staff.
        </p>
      )}
    </div>
  )
}
