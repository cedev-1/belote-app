import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import { supabase } from '../lib/supabase'

// En prod, VITE_SERVER_URL pointe vers Railway. En dev, undefined = même origine → proxy Vite.
const SERVER_URL = import.meta.env.PROD ? import.meta.env.VITE_SERVER_URL : undefined

export function useSocket() {
  const socketRef = useRef<Socket | null>(null)
  const [socket, setSocket] = useState<Socket | null>(null)

  useEffect(() => {
    let cancelled = false
    let s: Socket | undefined

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      s = io(SERVER_URL as string, {
        auth: { token: session?.access_token },
      })
      socketRef.current = s
      setSocket(s)
    }).catch(err => {
      console.error('[useSocket] getSession failed:', err)
    })

    return () => {
      cancelled = true
      s?.disconnect()
      socketRef.current = null
      setSocket(null)
    }
  }, [])

  return { socket, socketRef }
}
