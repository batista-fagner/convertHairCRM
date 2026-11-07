import { useState } from 'react'
import { Lock } from 'lucide-react'

const EXPECTED_HASH = import.meta.env.VITE_COLDCALL_PASSWORD_HASH || ''

// Trava extra só pra essa aba — a tela de Cold Call é vista por outras pessoas
// que usam o CRM, e essa lista/script é pessoal. Mesmo esquema client-side do
// login principal (SHA-256 + sessionStorage): não é uma trava de API real,
// só evita que quem tem acesso ao CRM abra essa aba sem querer/saber.
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export default function ColdCallGate({ children }) {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem('coldcall_auth') === EXPECTED_HASH)
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')

  // Em dev (npm run dev / localhost) pula a trava, igual ao RequireAuth do App.jsx.
  if (import.meta.env.DEV) return children
  if (unlocked) return children

  async function handleSubmit(e) {
    e.preventDefault()
    const hash = await sha256(pass)
    if (EXPECTED_HASH && hash === EXPECTED_HASH) {
      sessionStorage.setItem('coldcall_auth', hash)
      setUnlocked(true)
    } else {
      setError('Senha incorreta.')
    }
  }

  return (
    <div className="h-full flex items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-xs bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4 text-slate-700">
          <Lock className="w-4 h-4" />
          <h2 className="font-semibold text-sm">Área restrita — Cold Call</h2>
        </div>
        <input
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          autoFocus
          required
          placeholder="Senha"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500 mb-3"
        />
        {error && <p className="text-red-600 text-xs mb-3">{error}</p>}
        <button
          type="submit"
          className="w-full bg-violet-600 hover:bg-violet-700 text-white rounded-lg py-2 text-sm font-medium transition"
        >
          Entrar
        </button>
      </form>
    </div>
  )
}
