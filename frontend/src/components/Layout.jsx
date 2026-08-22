import { useState, useEffect, useRef } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { io } from 'socket.io-client'
import {
  LayoutDashboard,
  Megaphone,
  Users,
  KanbanSquare,
  FileText,
  BarChart3,
  Mail,
  Settings,
  ChevronLeft,
  ChevronRight,
  Bell,
  Search,
  TrendingUp,
  Zap,
  MessageCircle,
  Sparkles,
  Video,
  Image,
  LogOut,
  MessageSquare,
  Camera,
  FileSpreadsheet,
} from 'lucide-react'

const NAV_GROUPS = [
  {
    label: 'Visão Geral',
    items: [
      { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
      { icon: BarChart3, label: 'Analytics', path: '/analytics' },
    ],
  },
  {
    label: 'Funil',
    items: [
      { icon: Megaphone, label: 'Campanhas', path: '/campaigns', disabled: true },
      { icon: FileText, label: 'Formulários', path: '/forms' },
      { icon: Users, label: 'Leads', path: '/leads' },
      { icon: KanbanSquare, label: 'Kanban', path: '/kanban' },
      { icon: FileSpreadsheet, label: 'Formulário Instantâneo', path: '/instant-form-leads' },
    ],
  },
  {
    label: 'Automação',
    items: [
      { icon: Mail, label: 'Email Sequences', path: '/email-sequences', disabled: true },
      { icon: MessageCircle, label: 'WhatsApp', path: '/whatsapp' },
    ],
  },
  {
    label: 'SMS (US)',
    items: [
      { icon: MessageSquare, label: 'Inbox', path: '/sms', badgeKey: 'smsUnread' },
    ],
  },
  {
    label: 'Integrações',
    items: [
      { icon: MessageCircle, label: 'Instagram Leads', path: '/instagram' },
      { icon: Zap, label: 'IG Automação', path: '/instagram-auto' },
      { icon: Camera, label: 'DM Inbox', path: '/ig-inbox', badgeKey: 'igUnread' },
    ],
  },
  {
    label: 'Conteúdo',
    items: [
      { icon: Sparkles, label: 'Carrossel IG', path: '/content', disabled: true },
      { icon: Video, label: 'Vídeos', path: '/videos' },
      { icon: Image, label: 'Posts IG', path: '/instagram-posts' },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { icon: Settings, label: 'Configurações', path: '/settings' },
    ],
  },
]

const PAGE_TITLES = {
  '/': 'Dashboard',
  '/campaigns': 'Campanhas',
  '/leads': 'Leads',
  '/forms': 'Formulários',
  '/analytics': 'Analytics',
  '/email-sequences': 'Email Sequences',
  '/whatsapp': 'WhatsApp & Leads',
  '/sms': 'SMS Inbox',
  '/instagram': 'Instagram Leads',
  '/instagram-auto': 'IG Automação',
  '/ig-inbox': 'Instagram DM Inbox',
  '/content': 'Carrossel IG',
  '/videos': 'Vídeos de Follow-up',
  '/instagram-posts': 'Posts no Instagram',
  '/kanban': 'Kanban de Leads',
  '/settings': 'Configurações',
}

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'
const SOCKET_URL = API.replace(/\/api\/?$/, '') || 'http://localhost:3002'

/**
 * Sem polling de propósito: essa combinação de 3 fetches rodava a cada 60s em
 * TODA página do CRM (Layout envolve todas as rotas) e era o maior consumidor
 * de egress do projeto — `/leads/stats` em particular hidratava a tabela
 * `leads` inteira a cada chamada. Agora busca 1x ao montar e depois só reage
 * a eventos que o backend já emite (lead:created, sms:contact:updated,
 * ig:conversation:updated) — os re-fetches de sms/ig são disparados por
 * evento, não por relógio, então não contam como polling.
 */
function useHeaderStats() {
  const [leadsHoje, setLeadsHoje] = useState(null)
  const [smsUnread, setSmsUnread] = useState(0)
  const [igUnread, setIgUnread] = useState(0)

  const fetchSmsStats = async () => {
    try {
      const res = await fetch(`${API}/sms/stats`)
      const data = await res.json()
      setSmsUnread(data?.unreadConversations || 0)
    } catch { /* mantém o valor anterior — falha pontual não deve zerar o badge */ }
  }

  const fetchIgStats = async () => {
    try {
      const res = await fetch(`${API}/ig-auto/stats`)
      const data = await res.json()
      setIgUnread(data?.unreadTotal || 0)
    } catch { /* idem */ }
  }

  const handlersRef = useRef()
  handlersRef.current = { fetchSmsStats, fetchIgStats }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/leads/stats`)
        const data = await res.json()
        setLeadsHoje(data.todayCount ?? 0)
      } catch {
        setLeadsHoje(0)
      }
    })()
    fetchSmsStats()
    fetchIgStats()

    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] })
    socket.on('lead:created', () => setLeadsHoje(n => (n ?? 0) + 1))
    socket.on('sms:contact:created', () => handlersRef.current.fetchSmsStats())
    socket.on('sms:contact:updated', () => handlersRef.current.fetchSmsStats())
    socket.on('ig:conversation:created', () => handlersRef.current.fetchIgStats())
    socket.on('ig:conversation:updated', () => handlersRef.current.fetchIgStats())
    return () => socket.disconnect()
  }, [])

  return { leadsHoje, smsUnread, igUnread }
}

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { leadsHoje, smsUnread, igUnread } = useHeaderStats()
  const navBadges = { smsUnread, igUnread }

  function handleLogout() {
    sessionStorage.removeItem('crm_auth')
    navigate('/login', { replace: true })
  }

  const pageTitle = PAGE_TITLES[location.pathname] || 'Funnel Platform'
  const isActive = (path) =>
    path === '/' ? location.pathname === '/' : location.pathname === path

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">

      {/* Sidebar */}
      <aside className={`${collapsed ? 'w-16' : 'w-60'} bg-slate-900 flex flex-col transition-all duration-200 shrink-0`}>

        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-700/50">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-violet-500 rounded-lg flex items-center justify-center">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-white text-sm tracking-wide">FunnelCRM</span>
            </div>
          )}
          {collapsed && (
            <div className="w-7 h-7 bg-violet-500 rounded-lg flex items-center justify-center mx-auto">
              <Zap className="w-4 h-4 text-white" />
            </div>
          )}
          {!collapsed && (
            <button
              onClick={() => setCollapsed(true)}
              className="p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-6">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              {!collapsed && (
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest px-2 mb-1.5">
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map(({ icon: Icon, label, path, badgeKey, disabled }) => {
                  const badge = badgeKey ? navBadges[badgeKey] : 0
                  if (disabled) {
                    return (
                      <div
                        key={path}
                        title={collapsed ? `${label} (em breve)` : 'Em breve'}
                        className="flex items-center gap-3 px-2 py-2 rounded-lg text-sm text-slate-600 opacity-50 cursor-not-allowed select-none"
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        {!collapsed && <span>{label}</span>}
                      </div>
                    )
                  }
                  return (
                    <Link
                      key={path}
                      to={path}
                      title={collapsed ? label : ''}
                      className={`flex items-center gap-3 px-2 py-2 rounded-lg transition-all text-sm ${
                        isActive(path)
                          ? 'bg-violet-600 text-white font-medium'
                          : 'text-slate-400 hover:text-white hover:bg-slate-700/60'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      {!collapsed && <span>{label}</span>}
                      {!collapsed && badge > 0 && (
                        <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-sky-500 text-white text-[10px] font-bold flex items-center justify-center">
                          {badge > 99 ? '99+' : badge}
                        </span>
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Collapsed toggle */}
        {collapsed && (
          <div className="p-2 border-t border-slate-700/50">
            <button
              onClick={() => setCollapsed(false)}
              className="w-full flex items-center justify-center p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* User info + logout */}
        {!collapsed && (
          <div className="p-3 border-t border-slate-700/50">
            <div className="flex items-center gap-2.5 px-2 py-1.5">
              <div className="w-7 h-7 rounded-full bg-violet-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                F
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-white truncate">Fagner Batista</p>
                <p className="text-[10px] text-slate-400 truncate">Admin</p>
              </div>
              <button
                onClick={handleLogout}
                title="Sair"
                className="p-1 text-slate-400 hover:text-red-400 transition"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="p-2 border-t border-slate-700/50">
            <button
              onClick={handleLogout}
              title="Sair"
              className="w-full flex items-center justify-center p-2 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded-lg transition"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0">

          {/* Esquerda: título da página */}
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold text-slate-800">{pageTitle}</h1>
          </div>

          {/* Centro: busca */}
          <div className="hidden md:flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2 w-64">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              type="text"
              placeholder="Buscar leads, campanhas..."
              className="bg-transparent text-sm text-slate-600 placeholder-slate-400 outline-none w-full"
            />
          </div>

          {/* Direita: stats rápidas + notificações */}
          <div className="flex items-center gap-4">

            {/* Stats rápidas */}
            <div className="hidden lg:flex items-center gap-4 text-xs text-slate-500">
              <div className="flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-violet-500" />
                <span>
                  {leadsHoje === null ? '...' : `${leadsHoje} lead${leadsHoje !== 1 ? 's' : ''} hoje`}
                </span>
              </div>
            </div>

            {/* Notificações */}
            <button className="relative p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition">
              <Bell className="w-4.5 h-4.5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-violet-500 rounded-full" />
            </button>

            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-violet-500 flex items-center justify-center text-white text-xs font-bold cursor-pointer">
              F
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
