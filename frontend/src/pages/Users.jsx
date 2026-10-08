import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { UserPlus, Loader2, KeyRound, CheckCircle2, AlertTriangle, Power } from 'lucide-react'
import { getUser } from '../lib/auth'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

const ROLE_LABEL = { socio: 'Sócio', sdr: 'SDR' }

const inputClass = 'w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300'

function formatDate(value) {
  if (!value) return 'nunca'
  return new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/**
 * Cadastro de usuários do CRM (só sócio). Ao criar ou "reenviar acesso", o
 * backend gera a senha e manda por email (Resend). Se o email falhar, a senha
 * aparece aqui uma única vez pra ser repassada manualmente.
 */
export default function Users() {
  const me = getUser()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', email: '', role: 'sdr' })
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [notice, setNotice] = useState(null) // { type: 'ok' | 'warn' | 'error', text, password? }

  async function load() {
    try {
      const res = await fetch(`${API}/auth/users`)
      if (res.ok) setUsers(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (me?.role !== 'socio') return <Navigate to="/" replace />

  function showResult(data, action) {
    if (data.emailSent) {
      setNotice({ type: 'ok', text: `${action} Os dados de acesso foram enviados para ${data.user.email}.` })
    } else {
      setNotice({ type: 'warn', text: `${action} O email NÃO foi enviado — repasse a senha para ${data.user.email} manualmente:`, password: data.password })
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    setNotice(null)
    try {
      const res = await fetch(`${API}/auth/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNotice({ type: 'error', text: data.message || 'Erro ao criar usuário.' })
        return
      }
      showResult(data, 'Usuário criado.')
      setForm({ name: '', email: '', role: 'sdr' })
      load()
    } finally {
      setSaving(false)
    }
  }

  async function handleResetAccess(user) {
    if (!window.confirm(`Gerar uma nova senha para ${user.email}? A senha atual deixa de funcionar.`)) return
    setBusyId(user.id)
    setNotice(null)
    try {
      const res = await fetch(`${API}/auth/users/${user.id}/reset-access`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) setNotice({ type: 'error', text: data.message || 'Erro ao gerar nova senha.' })
      else showResult(data, 'Nova senha gerada.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleUpdate(user, patch) {
    setBusyId(user.id)
    setNotice(null)
    try {
      const res = await fetch(`${API}/auth/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) setNotice({ type: 'error', text: data.message || 'Erro ao atualizar usuário.' })
      else setUsers((list) => list.map((u) => (u.id === user.id ? data : u)))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <form onSubmit={handleCreate} className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-violet-600" />
          <h2 className="text-sm font-semibold text-slate-800">Novo usuário</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_140px_auto] gap-3">
          <input className={inputClass} placeholder="Nome" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={inputClass} placeholder="Email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <select className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="sdr">SDR</option>
            <option value="socio">Sócio</option>
          </select>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Criar e enviar acesso
          </button>
        </div>
        <p className="text-xs text-slate-400">A senha é gerada automaticamente e enviada para o email do usuário. SDR só enxerga o Kanban.</p>
      </form>

      {notice && (
        <div className={`rounded-xl border p-4 text-sm flex gap-2 ${
          notice.type === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : notice.type === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-800'
            : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {notice.type === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
          <div>
            <p>{notice.text}</p>
            {notice.password && <p className="mt-1 font-mono font-semibold select-all">{notice.password}</p>}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 text-slate-400 text-sm py-12">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left font-medium px-4 py-3">Usuário</th>
                <th className="text-left font-medium px-4 py-3">Papel</th>
                <th className="text-left font-medium px-4 py-3">Último login</th>
                <th className="text-right font-medium px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => {
                const isMe = u.id === me?.id
                const busy = busyId === u.id
                return (
                  <tr key={u.id} className={u.active ? '' : 'opacity-50'}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{u.name}{isMe && <span className="text-slate-400 font-normal"> (você)</span>}</p>
                      <p className="text-xs text-slate-500">{u.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        className="text-sm border border-slate-200 rounded-lg px-2 py-1 disabled:opacity-60"
                        value={u.role}
                        disabled={isMe || busy}
                        onChange={(e) => handleUpdate(u, { role: e.target.value })}
                      >
                        {Object.entries(ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{u.active ? formatDate(u.lastLoginAt) : 'desativado'}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleResetAccess(u)}
                          disabled={busy}
                          title="Gerar nova senha e reenviar por email"
                          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 transition"
                        >
                          <KeyRound className="w-3.5 h-3.5" /> Reenviar acesso
                        </button>
                        {!isMe && (
                          <button
                            onClick={() => handleUpdate(u, { active: !u.active })}
                            disabled={busy}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded-lg disabled:opacity-40 transition ${
                              u.active ? 'text-red-600 border-red-200 hover:bg-red-50' : 'text-emerald-600 border-emerald-200 hover:bg-emerald-50'
                            }`}
                          >
                            <Power className="w-3.5 h-3.5" /> {u.active ? 'Desativar' : 'Ativar'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
