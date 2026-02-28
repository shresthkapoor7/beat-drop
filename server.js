import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

// --- Instructions ---
// 1. npm install
// 2. node server.js
// 3. Open http://localhost:3000 for the Host Screen
// -------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer);

app.use(express.static(path.join(__dirname, 'public')));

// ── Lyria session (module-level so vote handler can update prompts) ───────────
let lyriaSession = null;

const BASE_PROMPTS = [
  { text: 'disco funk',   weight: 1.5 },
  { text: 'danceable',    weight: 1.0 },
  { text: 'Rhodes Piano', weight: 0.8 },
];

// ── Word-panel vote state ─────────────────────────────────────────────────────
let panelVotes = {};
let panelTimer  = null;

const PANEL_BEAT_MS = Math.round(60000 / 118); // ≈ 508ms per beat

// ── Room & player state ───────────────────────────────────────────────────────
function generateRoomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

const currentRoomId = generateRoomId();
let   hostSocket    = null;
const players       = new Map();

app.get('/room', (_req, res) => res.json({ roomId: currentRoomId }));

// ── Lyria connection ──────────────────────────────────────────────────────────
async function connectLyria() {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[Lyria] No GEMINI_API_KEY — no music');
    return;
  }

  try {
    console.log('[Lyria] Connecting to Gemini...');
    const client = new GoogleGenAI({
      apiKey:      process.env.GEMINI_API_KEY,
      httpOptions: { apiVersion: 'v1alpha' },
    });

    lyriaSession = await client.live.music.connect({
      model: 'models/lyria-realtime-exp',
      callbacks: {
        onmessage: (message) => {
          const chunks = message.serverContent?.audioChunks;
          if (!chunks?.length || !hostSocket) return;
          // data is already base64 from the JSON payload — send as-is
          const data = chunks[0].data;
          if (data) hostSocket.emit('audio_chunk', data);
        },
        onerror: (err) => console.error('[Lyria] Stream error:', err),
        onclose: () => {
          console.warn('[Lyria] Connection closed, reconnecting in 3s...');
          lyriaSession = null;
          setTimeout(connectLyria, 3000);
        },
      },
    });

    await lyriaSession.setWeightedPrompts({
      weightedPrompts: [
        { text: 'disco funk',   weight: 1.5 },
        { text: 'danceable',    weight: 1.0 },
        { text: 'Rhodes Piano', weight: 0.8 },
        { text: 'upbeat',       weight: 0.7 },
      ],
    });

    await lyriaSession.setMusicGenerationConfig({
      musicGenerationConfig: { bpm: 118, brightness: 0.7, density: 0.75 },
    });

    lyriaSession.play();
    console.log('[Lyria] Music streaming started');

  } catch (err) {
    console.error('[Lyria] Failed to connect:', err.message);
  }
}

// ── Socket.io — same as original, just forwards inputs ────────────────────────
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on('register', (data) => {
    const { role, roomId, name } = data;
    if (roomId !== currentRoomId) {
      console.log(`Warning: Socket ${socket.id} presented mismatched roomId ${roomId}`);
    }

    if (role === 'host') {
      console.log(`Host registered: ${socket.id}`);
      hostSocket = socket;
      // Catch up new host on existing players
      players.forEach(p => {
        hostSocket.emit('player_joined', { id: p.id, name: p.name, totalPlayers: players.size });
      });

    } else if (role === 'controller') {
      console.log(`Player registered: ${socket.id} as ${name || 'Unknown'}`);
      players.set(socket.id, { id: socket.id, name: name || 'Player' });
      if (hostSocket) {
        hostSocket.emit('player_joined', { id: socket.id, name: name || 'Player', totalPlayers: players.size });
      }
    }
  });

  // Forward inputs directly to host — game logic stays in the client
  socket.on('input', (data) => {
    if (players.has(socket.id) && hostSocket) {
      hostSocket.emit('input', {
        playerId:  socket.id,
        direction: data.direction,
        timestamp: data.timestamp || Date.now(),
      });
    }
  });

  // ── Word-panel: host triggers, controllers vote ───────────────────────────
  socket.on('word_panel_start', ({ words }) => {
    // Only the host may start a panel
    if (!hostSocket || socket.id !== hostSocket.id) return;

    panelVotes = {};
    if (panelTimer) { clearTimeout(panelTimer); panelTimer = null; }

    const duration = 4 * PANEL_BEAT_MS; // ≈ 2033ms

    // Broadcast word list to every controller
    players.forEach((_, sid) => {
      io.to(sid).emit('show_word_panel', { words, duration });
    });

    panelTimer = setTimeout(async () => {
      // Tally votes — pick word with most votes (ties: first found)
      let winner = null, maxVotes = -1;
      for (const [word, count] of Object.entries(panelVotes)) {
        if (count > maxVotes) { maxVotes = count; winner = word; }
      }

      const result = { winner, votes: { ...panelVotes } };
      console.log('[Panel] Result:', result);

      // Notify host + all controllers
      if (hostSocket) hostSocket.emit('word_panel_result', result);
      players.forEach((_, sid) => io.to(sid).emit('word_panel_result', result));

      // Update Lyria prompt if we have a winner and an active session
      if (winner && lyriaSession) {
        try {
          await lyriaSession.setWeightedPrompts({
            weightedPrompts: [...BASE_PROMPTS, { text: winner, weight: 2.0 }],
          });
          console.log(`[Lyria] Prompt updated → "${winner}"`);
        } catch (err) {
          console.error('[Lyria] Prompt update failed:', err.message);
        }
      }

      panelVotes = {};
      panelTimer  = null;
    }, duration);
  });

  socket.on('vote', ({ word }) => {
    if (!players.has(socket.id) || !word) return;
    panelVotes[word] = (panelVotes[word] || 0) + 1;
    console.log(`[Vote] ${players.get(socket.id).name}: "${word}"`);
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    if (hostSocket && socket.id === hostSocket.id) {
      hostSocket = null;
    } else if (players.has(socket.id)) {
      players.delete(socket.id);
      if (hostSocket) hostSocket.emit('player_left', { id: socket.id, totalPlayers: players.size });
    }
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`\n===============================================`);
  console.log(` Beat Drop  →  http://localhost:${PORT}`);
  console.log(`===============================================\n`);
  connectLyria();
});
