import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { IG_SOCKET_URL } from '../lib/igInboxApi'

/**
 * Assina os eventos do canal de Instagram DM. Mesmo padrão de useSmsSocket:
 * handlers numa ref pra não recriar a conexão a cada render.
 */
export function useIgSocket(handlers) {
  const [connected, setConnected] = useState(false)
  const ref = useRef(handlers)

  useEffect(() => {
    ref.current = handlers
  })

  useEffect(() => {
    const socket = io(IG_SOCKET_URL, { transports: ['websocket', 'polling'] })

    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('ig:message:created', (m) => ref.current.onMessage?.(m))
    socket.on('ig:conversation:created', (c) => ref.current.onConversation?.(c))
    socket.on('ig:conversation:updated', (c) => ref.current.onConversation?.(c))

    return () => socket.disconnect()
  }, [])

  return connected
}
