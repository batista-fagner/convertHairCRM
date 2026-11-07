const API = import.meta.env.VITE_API_URL || 'http://localhost:3002/api'
const TOKEN_KEY = 'crm_token'
const USER_KEY = 'crm_user'

// localStorage (não sessionStorage): a sessão vale entre abas e sobrevive a
// fechar o navegador — expira junto com o JWT (JWT_EXPIRES_IN no backend).
export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

export function getUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null') } catch { return null }
}

export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  } catch { /* storage bloqueado — nada a limpar */ }
}

/** Anexa `?token=` em links abertos por navegação (download, OAuth), que não mandam header. */
export function withToken(url) {
  const token = getToken()
  if (!token) return url
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
}

/** Opções do socket.io com o JWT no handshake (o RealtimeGateway recusa sem ele). */
export function socketOptions() {
  return { transports: ['websocket', 'polling'], auth: { token: getToken() } }
}

/**
 * Intercepta o fetch global: toda chamada pra API do CRM leva o
 * `Authorization: Bearer`, e um 401 (sessão expirada/inválida) derruba a
 * sessão e manda pro login. Assim nenhuma das chamadas espalhadas pelas
 * páginas precisa saber de autenticação.
 */
export function installFetchAuth() {
  const originalFetch = window.fetch.bind(window)
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input)
    if (!url.startsWith(API)) return originalFetch(input, init)

    const token = getToken()
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined))
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
    const res = await originalFetch(input, { ...init, headers })

    if (res.status === 401 && !url.startsWith(`${API}/auth/login`)) {
      clearSession()
      if (window.location.pathname !== '/login') window.location.replace('/login')
    }
    return res
  }
}
