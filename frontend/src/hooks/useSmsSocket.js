import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { SOCKET_URL } from '../lib/smsApi'

/**
 * Assina os eventos do canal de SMS. Os handlers ficam numa ref para que a
 * conexão não seja recriada a cada render — sem isso o socket reconectaria
 * toda vez que a lista de conversas mudasse.
 */
export function useSmsSocket(handlers) {
  const [connected, setConnected] = useState(false)
  const ref = useRef(handlers)

  // Sem dep array: mantém os handlers sempre frescos sem recriar o socket.
  useEffect(() => {
    ref.current = handlers
  })

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] })

    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('sms:message:created', (m) => ref.current.onMessage?.(m))
    socket.on('sms:message:status', (s) => ref.current.onStatus?.(s))
    socket.on('sms:contact:created', (c) => ref.current.onContact?.(c))
    socket.on('sms:contact:updated', (c) => ref.current.onContact?.(c))

    return () => socket.disconnect()
  }, [])

  return connected
}
