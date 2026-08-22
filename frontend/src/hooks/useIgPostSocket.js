import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'
const SOCKET_URL = API.replace(/\/api\/?$/, '') || 'http://localhost:3002'

/**
 * Assina os eventos de posts do Instagram — substitui o polling de 15s da
 * tela de Posts. Handlers numa ref pra não recriar a conexão a cada render.
 */
export function useIgPostSocket(handlers) {
  const [connected, setConnected] = useState(false)
  const ref = useRef(handlers)

  useEffect(() => {
    ref.current = handlers
  })

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] })

    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('igpost:created', (p) => ref.current.onCreated?.(p))
    socket.on('igpost:updated', (p) => ref.current.onUpdated?.(p))

    return () => socket.disconnect()
  }, [])

  return connected
}
