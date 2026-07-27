const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

export const IG_SOCKET_URL = API.replace(/\/api\/?$/, '')

async function request(path, options = {}) {
  const res = await fetch(`${API}/ig-auto${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const err = new Error(data?.message?.message || data?.message || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

export const igInboxApi = {
  stats: () => request('/stats'),

  listConversations: ({ search = '', filter = 'all', page = 1, limit = 30 } = {}) => {
    const qs = new URLSearchParams({ filter, page: String(page), limit: String(limit) })
    if (search) qs.set('search', search)
    return request(`/conversations?${qs}`)
  },

  listMessages: (conversationId, { before, limit = 50 } = {}) => {
    const qs = new URLSearchParams({ limit: String(limit) })
    if (before) qs.set('before', before)
    return request(`/conversations/${conversationId}/messages?${qs}`)
  },

  listCommentEvents: (conversationId) => request(`/conversations/${conversationId}/comment-events`),

  sendMessage: (conversationId, text) =>
    request(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  markRead: (conversationId) => request(`/conversations/${conversationId}/read`, { method: 'PATCH' }),

  setAiPaused: (conversationId, paused) =>
    request(`/conversations/${conversationId}/ai`, { method: 'PATCH', body: JSON.stringify({ paused }) }),

  resetContext: (conversationId) => request(`/conversations/${conversationId}/reset`, { method: 'POST' }),
}
