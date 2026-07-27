const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

export const SOCKET_URL = API.replace(/\/api\/?$/, '')

async function request(path, options = {}) {
  const res = await fetch(`${API}/sms${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const err = new Error(data?.message?.message || data?.message || `Request failed (${res.status})`)
    err.status = res.status
    err.code = data?.message?.code || data?.code
    throw err
  }
  return data
}

export const smsApi = {
  stats: () => request('/stats'),

  listConversations: ({ search = '', filter = 'all', page = 1, limit = 30 } = {}) => {
    const qs = new URLSearchParams({ filter, page: String(page), limit: String(limit) })
    if (search) qs.set('search', search)
    return request(`/conversations?${qs}`)
  },

  listMessages: (contactId, { before, limit = 50 } = {}) => {
    const qs = new URLSearchParams({ limit: String(limit) })
    if (before) qs.set('before', before)
    return request(`/conversations/${contactId}/messages?${qs}`)
  },

  sendMessage: (contactId, text, pauseAi = true) =>
    request(`/conversations/${contactId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text, pauseAi }),
    }),

  markRead: (contactId) => request(`/conversations/${contactId}/read`, { method: 'PATCH' }),

  setAiPaused: (contactId, paused) =>
    request(`/conversations/${contactId}/ai`, { method: 'PATCH', body: JSON.stringify({ paused }) }),

  updateContact: (contactId, patch) =>
    request(`/conversations/${contactId}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  createContact: (payload) => request('/contacts', { method: 'POST', body: JSON.stringify(payload) }),

  optIn: (contactId, consentSource) =>
    request(`/conversations/${contactId}/opt-in`, {
      method: 'POST',
      body: JSON.stringify({ consentSource }),
    }),

  /** Só funciona com SMS_PROVIDER=mock — é o gatilho da demo end-to-end. */
  simulateInbound: (phone, text) =>
    request('/dev/simulate-inbound', { method: 'POST', body: JSON.stringify({ phone, text }) }),
}
