import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'
const SOCKET_URL = API.replace(/\/api\/?$/, '') || 'http://localhost:3002'

/**
 * Assina o progresso ao vivo do disparo em massa do Grupo WhatsApp — o envio
 * roda em background no backend (pode levar dezenas de minutos), esse socket
 * é o único jeito da tela acompanhar sem pollar.
 */
export function useGroupBroadcastSocket(handlers) {
  const [connected, setConnected] = useState(false)
  const ref = useRef(handlers)

  useEffect(() => {
    ref.current = handlers
  })

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] })

    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('groupbroadcast:progress', (p) => ref.current.onProgress?.(p))

    return () => socket.disconnect()
  }, [])

  return connected
}
