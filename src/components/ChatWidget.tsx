'use client'

import { useState, useEffect, useRef } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export default function ChatWidget() {
  const [isOpen, setIsOpen]       = useState(false)
  const [enabled, setEnabled]     = useState(false)
  const [checked, setChecked]     = useState(false)
  const [messages, setMessages]   = useState<Message[]>([])
  const [input, setInput]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const bottomRef                 = useRef<HTMLDivElement>(null)

  // Check if AI is enabled for this org on mount
  useEffect(() => {
    fetch('/api/ai/status')
      .then(r => r.json())
      .then((d: { enabled: boolean }) => { setEnabled(d.enabled); setChecked(true) })
      .catch(() => setChecked(true))
  }, [])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  if (!checked || !enabled) return null

  async function sendMessage() {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: Message = { role: 'user', content: text }
    const next = [...messages, userMsg]
    setMessages(next)
    setInput('')
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: messages }),
      })
      const data = await res.json() as { response?: string; error?: string }
      if (data.error) {
        setError(data.error)
      } else {
        setMessages([...next, { role: 'assistant', content: data.response ?? '' }])
      }
    } catch {
      setError('Failed to connect. Please try again.')
    }
    setLoading(false)
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen(o => !o)}
        aria-label="Open AI assistant"
        style={{
          position: 'fixed',
          bottom: '1.5rem',
          right: '1.5rem',
          width: '3rem',
          height: '3rem',
          borderRadius: '9999px',
          backgroundColor: '#111827',
          color: 'white',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.25rem',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          zIndex: 1000,
          transition: 'transform 0.15s',
        }}
      >
        {isOpen ? '✕' : '✦'}
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            bottom: '5.5rem',
            right: '1.5rem',
            width: '360px',
            maxWidth: 'calc(100vw - 2rem)',
            height: '520px',
            maxHeight: 'calc(100vh - 7rem)',
            backgroundColor: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '12px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 999,
            fontFamily: 'system-ui, sans-serif',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
            <span style={{ fontSize: '1rem' }}>✦</span>
            <div>
              <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#111827' }}>AI Assistant</div>
              <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Ask anything about your organisation&apos;s data</div>
            </div>
          </div>

          {/* Messages */}
          <div
            style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
          >
            {messages.length === 0 && !loading && (
              <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>✦</div>
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9375rem', color: '#374151', fontWeight: 500 }}>
                  Your organisational memory
                </p>
                <p style={{ margin: 0, fontSize: '0.8125rem', color: '#9ca3af', lineHeight: 1.6 }}>
                  Ask about past projects, meeting patterns, recurring blockers, team capacity, or anything in your data.
                </p>
                <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {[
                    'Have we tried anything like this before?',
                    'What projects went over capacity?',
                    'What recurring blockers show up in meetings?',
                  ].map(s => (
                    <button
                      key={s}
                      onClick={() => { setInput(s) }}
                      style={{ padding: '0.5rem 0.75rem', backgroundColor: '#f3f4f6', border: 'none', borderRadius: '6px', fontSize: '0.8125rem', color: '#374151', cursor: 'pointer', textAlign: 'left' }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    maxWidth: '85%',
                    padding: '0.625rem 0.875rem',
                    borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                    backgroundColor: msg.role === 'user' ? '#111827' : '#f3f4f6',
                    color: msg.role === 'user' ? 'white' : '#111827',
                    fontSize: '0.875rem',
                    lineHeight: 1.55,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ padding: '0.625rem 0.875rem', borderRadius: '12px 12px 12px 2px', backgroundColor: '#f3f4f6', fontSize: '0.875rem', color: '#9ca3af' }}>
                  Thinking…
                </div>
              </div>
            )}

            {error && (
              <div style={{ padding: '0.625rem 0.875rem', borderRadius: '6px', backgroundColor: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', fontSize: '0.8125rem' }}>
                {error}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '0.75rem', borderTop: '1px solid #f3f4f6', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Ask anything…"
                rows={1}
                disabled={loading}
                style={{
                  flex: 1,
                  padding: '0.5rem 0.75rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  fontSize: '0.875rem',
                  resize: 'none',
                  fontFamily: 'inherit',
                  lineHeight: 1.5,
                  outline: 'none',
                  maxHeight: '100px',
                  overflowY: 'auto',
                }}
              />
              <button
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                style={{
                  padding: '0.5rem 0.875rem',
                  backgroundColor: input.trim() && !loading ? '#111827' : '#e5e7eb',
                  color: input.trim() && !loading ? 'white' : '#9ca3af',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
                  flexShrink: 0,
                }}
              >
                Send
              </button>
            </div>
            <p style={{ margin: '0.375rem 0 0 0', fontSize: '0.7rem', color: '#d1d5db', textAlign: 'right' }}>
              Enter to send · Shift+Enter for newline
            </p>
          </div>
        </div>
      )}
    </>
  )
}
