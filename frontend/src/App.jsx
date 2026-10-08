import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Campaigns from './pages/Campaigns'
import Leads from './pages/Leads'
import Forms from './pages/Forms'
import Analytics from './pages/Analytics'
import EmailSequences from './pages/EmailSequences'
import WhatsAppLeads from './pages/WhatsAppLeads'
import InstagramLeads from './pages/InstagramLeads'
import Settings from './pages/Settings'
import FormPublic from './pages/FormPublic'
import InstagramAutomation from './pages/InstagramAutomation'
import Content from './pages/Content'
import Videos from './pages/Videos'
import AudioLibrary from './pages/AudioLibrary'
import InstagramPosts from './pages/InstagramPosts'
import KanbanLeads from './pages/KanbanLeads'
import InstantFormLeads from './pages/InstantFormLeads'
import Prospeccao from './pages/Prospeccao'
import ColdCall from './pages/ColdCall'
import ColdCallGate from './components/ColdCallGate'
import SmsInbox from './pages/sms/SmsInbox'
import IgInbox from './pages/instagram-inbox/IgInbox'
import Login from './pages/Login'
import GroupWorkshop from './pages/GroupWorkshop'
import Quizzes from './pages/Quizzes'
import Users from './pages/Users'
import { getToken, getUser } from './lib/auth'

// Carregado sob demanda de propósito — remotion + @remotion/player somam
// ~300-500KB gzipado, peso que ninguém que nunca abre o editor deveria pagar
// no carregamento inicial do CRM.
const VideoEdit = lazy(() => import('./pages/VideoEdit'))

const PageLoading = () => (
  <div className="flex items-center justify-center gap-2 text-slate-400 text-sm py-24">
    <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
  </div>
)

function RequireAuth({ children }) {
  // A validade real do token é checada pela API: qualquer 401 derruba a
  // sessão e volta pro login (ver installFetchAuth em lib/auth.js).
  if (!getToken() || !getUser()) return <Navigate to="/login" replace />
  return children
}

// Login da SDR só enxerga /kanban — qualquer outra rota (mesmo digitada direto
// na URL) redireciona pra lá.
function RequireRole({ children }) {
  const location = useLocation()
  if (getUser()?.role === 'sdr' && location.pathname !== '/kanban') {
    return <Navigate to="/kanban" replace />
  }
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/f/:id" element={<FormPublic />} />
        <Route element={<RequireAuth><RequireRole><Layout /></RequireRole></RequireAuth>}>
          <Route index element={<Dashboard />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/kanban" element={<KanbanLeads />} />
          <Route path="/instant-form-leads" element={<InstantFormLeads />} />
          <Route path="/prospeccao" element={<Prospeccao />} />
          <Route path="/cold-call" element={<ColdCallGate><ColdCall /></ColdCallGate>} />
          <Route path="/group-workshop" element={<GroupWorkshop />} />
          <Route path="/forms" element={<Forms />} />
          <Route path="/quiz-builder" element={<Quizzes />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/email-sequences" element={<EmailSequences />} />
          <Route path="/whatsapp" element={<WhatsAppLeads />} />
          <Route path="/sms" element={<SmsInbox />} />
          <Route path="/instagram" element={<InstagramLeads />} />
          <Route path="/instagram-auto" element={<InstagramAutomation />} />
          <Route path="/ig-inbox" element={<IgInbox />} />
          <Route path="/content" element={<Content />} />
          <Route path="/videos" element={<Videos />} />
          <Route path="/audios" element={<AudioLibrary />} />
          <Route path="/video-edit" element={<Suspense fallback={<PageLoading />}><VideoEdit /></Suspense>} />
          <Route path="/instagram-posts" element={<InstagramPosts />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/usuarios" element={<Users />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
