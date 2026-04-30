import 'dotenv/config'

// Safety net — log unhandled async errors without crashing the server
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
})

import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import { existsSync } from 'fs'
import { join } from 'path'
import { registerSocketHandlers } from './socket/handlers'
import { gamesRouter } from './routes/games'
import { playersRouter } from './routes/players'
import { authMiddleware } from './middleware/auth'

const app = express()
const httpServer = createServer(app)

// En prod (container), le client est servi depuis le même serveur — pas besoin de CORS.
// En dev, on accepte l'URL du client Vite.
const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:5173'

const io = new Server(httpServer, {
  cors: { origin: clientUrl, credentials: true },
})

app.use(cors({ origin: clientUrl, credentials: true }))
app.use(express.json())

app.use('/api/games', authMiddleware, gamesRouter)
app.use('/api/players', authMiddleware, playersRouter)

app.get('/health', (_req, res) => res.json({ status: 'ok' }))

// Sert le client React en prod (quand le dossier public/ existe à côté du build serveur)
const publicPath = join(__dirname, '..', 'public')
if (existsSync(publicPath)) {
  app.use(express.static(publicPath))
  app.get('*', (_req, res) => res.sendFile(join(publicPath, 'index.html')))
}

registerSocketHandlers(io)

const PORT = process.env.PORT ?? 3002
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
