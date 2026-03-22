'use client'

import { useState, useRef, useEffect } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export default function AiChatWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Focus input when opened
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  async function sendMessage() {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: Message = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: messages.slice(-10),
        }),
      })
      const data = await res.json() as { response?: string; error?: string }

      if (!res.ok || data.error) {
        setError(data.error ?? 'Something went wrong')
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: data.response ?? '' }])
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Open AI assistant"
        style={{
          position: 'fixed',
          bottom: '1.5rem',
          right: '1.5rem',
          width: '3rem',
          height: '3rem',
          borderRadius: '9999px',
          background: 'var(--brand)',
          color: 'white',
          border: 'none',
          boxShadow: '0 4px 16px rgba(14,165,233,.45)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.25rem',
          zIndex: 200,
          transition: 'transform 0.15s, box-shadow 0.15s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.08)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
      >
        {open ? '✕' : '✨'}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          style={{
            position: 'fixed',
            bottom: '5rem',
            right: '1.5rem',
            width: '380px',
            maxWidth: 'calc(100vw - 3rem)',
            height: '520px',
            maxHeight: 'calc(100vh - 7rem)',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-md)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 199,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{
            padding: '0.875rem 1rem',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: 'var(--surface)',
          }}>
            <span style={{ fontSize: '1.1rem' }}>✨</span>
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: '0.875rem', color: 'var(--text)' }}>AI Assistant</p>
              <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-subtle)' }}>Searches your org&apos;s projects, meetings &amp; goals</p>
            </div>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '0.875rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.625rem',
          }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', marginTop: '2rem' }}>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: '0 0 0.5rem 0' }}>
                  Ask me anything about your organisation.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', alignItems: 'center' }}>
                  {[
                    'What are our active projects?',
                    'Show me recurring blockers',
                    'What goals are at risk?',
                  ].map(hint => (
                    <button
                      key={hint}
                      onClick={() => { setInput(hint); inputRef.current?.focus() }}
                      style={{
                        background: 'var(--surface-muted)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '0.375rem 0.75rem',
                        fontSize: '0.75rem',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                      }}
                    >
                      {hint}
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
                    padding: '0.5rem 0.75rem',
                    borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                    background: msg.role === 'user' ? 'var(--brand)' : 'var(--surface-muted)',
                    color: msg.role === 'user' ? 'white' : 'var(--text)',
                    fontSize: '0.8125rem',
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    border: msg.role === 'assistant' ? '1px solid var(--border)' : 'none',
                  }}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{
                  padding: '0.5rem 0.875rem',
                  background: 'var(--surface-muted)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px 12px 12px 4px',
                  fontSize: '0.8125rem',
                  color: 'var(--text-subtle)',
                }}>
                  Thinking…
                </div>
              </div>
            )}

            {error && (
              <div style={{
                padding: '0.5rem 0.75rem',
                background: 'var(--red-bg)',
                border: '1px solid var(--red-border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.75rem',
                color: 'var(--red)',
              }}>
                {error}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{
            padding: '0.75rem',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'flex-end',
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question… (Enter to send)"
              rows={1}
              style={{
                flex: 1,
                padding: '0.5rem 0.625rem',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8125rem',
                resize: 'none',
                outline: 'none',
                fontFamily: 'inherit',
                lineHeight: 1.5,
                maxHeight: '100px',
                overflowY: 'auto',
                background: 'var(--surface)',
                color: 'var(--text)',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--brand)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
            />
            <button
              onClick={() => void sendMessage()}
              disabled={!input.trim() || loading}
              style={{
                padding: '0.5rem 0.875rem',
                background: input.trim() && !loading ? 'var(--brand)' : 'var(--border)',
                color: input.trim() && !loading ? 'white' : 'var(--text-subtle)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
                fontSize: '0.8125rem',
                fontWeight: 600,
                transition: 'background 0.1s',
                flexShrink: 0,
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  )
}
