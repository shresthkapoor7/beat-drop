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
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(path.join(__dirname, 'public')));

// ── Lyria session (module-level so vote handler can update prompts) ───────────
let lyriaSession = null;

// ── Word pool — full 158 words from Lyria docs ────────────────────────────────
const LYRIA_WORD_POOL = [
  // Instruments
  '303 Acid Bass', '808 Hip Hop Beat', 'Accordion', 'Alto Saxophone',
  'Bagpipes', 'Balalaika Ensemble', 'Banjo', 'Bass Clarinet', 'Bongos',
  'Boomy Bass', 'Bouzouki', 'Buchla Synths', 'Cello', 'Charango',
  'Clavichord', 'Conga Drums', 'Didgeridoo', 'Dirty Synths', 'Djembe',
  'Drumline', 'Dulcimer', 'Fiddle', 'Flamenco Guitar', 'Funk Drums',
  'Glockenspiel', 'Guitar', 'Hang Drum', 'Harmonica', 'Harp',
  'Harpsichord', 'Hurdy-gurdy', 'Kalimba', 'Koto', 'Lyre', 'Mandolin',
  'Maracas', 'Marimba', 'Mbira', 'Mellotron', 'Metallic Twang',
  'Moog Oscillations', 'Ocarina', 'Persian Tar', 'Pipa', 'Precision Bass',
  'Ragtime Piano', 'Rhodes Piano', 'Shamisen', 'Shredding Guitar',
  'Sitar', 'Slide Guitar', 'Smooth Pianos', 'Spacey Synths', 'Steel Drum',
  'Synth Pads', 'Tabla', 'TR-909 Drum Machine', 'Trumpet', 'Tuba',
  'Vibraphone', 'Viola Ensemble', 'Warm Acoustic Guitar', 'Woodwinds',
  // Genre
  'Acid Jazz', 'Afrobeat', 'Alternative Country', 'Baroque', 'Bengal Baul',
  'Bhangra', 'Bluegrass', 'Blues Rock', 'Bossa Nova', 'Breakbeat',
  'Celtic Folk', 'Chillout', 'Chiptune', 'Classic Rock', 'Contemporary R&B',
  'Cumbia', 'Deep House', 'Disco Funk', 'Drum & Bass', 'Dubstep',
  'EDM', 'Electro Swing', 'Funk Metal', 'G-funk', 'Garage Rock',
  'Glitch Hop', 'Grime', 'Hyperpop', 'Indian Classical', 'Indie Electronic',
  'Indie Folk', 'Indie Pop', 'Irish Folk', 'Jam Band', 'Jamaican Dub',
  'Jazz Fusion', 'Latin Jazz', 'Lo-Fi Hip Hop', 'Marching Band', 'Merengue',
  'New Jack Swing', 'Minimal Techno', 'Moombahton', 'Neo-Soul',
  'Orchestral Score', 'Piano Ballad', 'Polka', 'Post-Punk',
  '60s Psychedelic Rock', 'Psytrance', 'R&B', 'Reggae', 'Reggaeton',
  'Renaissance Music', 'Salsa', 'Shoegaze', 'Ska', 'Surf Rock',
  'Synthpop', 'Techno', 'Trance', 'Trap Beat', 'Trip Hop',
  'Vaporwave', 'Witch House',
  // Mood
  'Acoustic Instruments', 'Ambient', 'Bright Tones', 'Chill',
  'Crunchy Distortion', 'Danceable', 'Dreamy', 'Echo', 'Emotional',
  'Ethereal Ambience', 'Experimental', 'Fat Beats', 'Funky',
  'Glitchy Effects', 'Huge Drop', 'Live Performance', 'Lo-fi',
  'Ominous Drone', 'Psychedelic', 'Rich Orchestration', 'Saturated Tones',
  'Subdued Melody', 'Sustained Chords', 'Swirling Phasers', 'Tight Groove',
  'Unsettling', 'Upbeat', 'Virtuoso', 'Weird Noises',
];

const WORDS_PER_USER = 5;

// Per-word density/brightness/guidance presets for obvious music shifts
const WORD_PRESETS = {
  'Dubstep': { density: 0.9, brightness: 0.9, guidance: 5.0 },
  'Drum & Bass': { density: 1.0, brightness: 0.8, guidance: 5.0 },
  'Hyperpop': { density: 0.95, brightness: 1.0, guidance: 4.5 },
  'Psytrance': { density: 0.9, brightness: 0.85, guidance: 4.5 },
  'Huge Drop': { density: 1.0, brightness: 1.0, guidance: 5.0 },
  'Glitchy Effects': { density: 0.9, brightness: 0.8, guidance: 4.5 },
  'Weird Noises': { density: 0.8, brightness: 0.7, guidance: 4.5 },
  'Chiptune': { density: 0.85, brightness: 0.95, guidance: 4.0 },
  'Fat Beats': { density: 0.85, brightness: 0.75, guidance: 4.0 },
  '808 Hip Hop Beat': { density: 0.8, brightness: 0.7, guidance: 4.0 },
  'TR-909 Drum Machine': { density: 0.8, brightness: 0.75, guidance: 4.0 },
  'Deep House': { density: 0.75, brightness: 0.7, guidance: 4.0 },
  'Disco Funk': { density: 0.8, brightness: 0.75, guidance: 3.5 },
  'Afrobeat': { density: 0.8, brightness: 0.75, guidance: 3.5 },
  'Electro Swing': { density: 0.7, brightness: 0.7, guidance: 3.5 },
  'Upbeat': { density: 0.8, brightness: 0.8, guidance: 3.5 },
  'Neo-Soul': { density: 0.6, brightness: 0.6, guidance: 3.0 },
  'Jazz Fusion': { density: 0.65, brightness: 0.6, guidance: 3.0 },
  'Orchestral Score': { density: 0.7, brightness: 0.7, guidance: 3.5 },
  'Minimal Techno': { density: 0.5, brightness: 0.6, guidance: 4.0 },
  'Reggae': { density: 0.5, brightness: 0.6, guidance: 3.0 },
  'Bluegrass': { density: 0.45, brightness: 0.65, guidance: 3.5 },
  'Celtic Folk': { density: 0.4, brightness: 0.65, guidance: 3.5 },
  'Bossa Nova': { density: 0.35, brightness: 0.55, guidance: 3.0 },
  'Trip Hop': { density: 0.55, brightness: 0.45, guidance: 3.0 },
  'Lo-Fi Hip Hop': { density: 0.4, brightness: 0.35, guidance: 2.5 },
  'Chill': { density: 0.3, brightness: 0.45, guidance: 2.5 },
  'Dreamy': { density: 0.25, brightness: 0.4, guidance: 2.0 },
  'Ambient': { density: 0.15, brightness: 0.3, guidance: 2.0 },
  'Ominous Drone': { density: 0.2, brightness: 0.15, guidance: 3.0 },
  'Ethereal Ambience': { density: 0.2, brightness: 0.35, guidance: 2.0 },
  'Hang Drum': { density: 0.35, brightness: 0.55, guidance: 3.0 },
  'Bagpipes': { density: 0.5, brightness: 0.65, guidance: 3.5 },
  'Cello': { density: 0.4, brightness: 0.5, guidance: 3.0 },
  'Harmonica': { density: 0.4, brightness: 0.6, guidance: 3.0 },
  'Sitar': { density: 0.5, brightness: 0.6, guidance: 3.5 },
  'Tabla': { density: 0.6, brightness: 0.6, guidance: 3.5 },
  'Moog Oscillations': { density: 0.6, brightness: 0.65, guidance: 3.5 },
  'Spacey Synths': { density: 0.5, brightness: 0.6, guidance: 3.0 },
  'Rhodes Piano': { density: 0.55, brightness: 0.6, guidance: 3.0 },
  'Accordion': { density: 0.45, brightness: 0.6, guidance: 3.0 },
};

const DEFAULT_PRESET = { density: 0.6, brightness: 0.6, guidance: 3.5 };
// Low-weight anchor so music always keeps a pulse, even on abstract votes
const ANCHOR_PROMPT = { text: 'danceable', weight: 0.3 };

function pickRandom(arr, n) {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

// Shared: tally votes → update Lyria + notify host + controllers
async function applyVoteResult(votes) {
  const sorted = Object.entries(votes).sort(([, a], [, b]) => b - a);
  const top10 = sorted.slice(0, 10);
  const winner = top10[0]?.[0] ?? null;
  const result = { winner, votes: { ...votes } };

  if (hostSocket) hostSocket.emit('word_panel_result', result);
  players.forEach((_, sid) => io.to(sid).emit('word_panel_result', result));

  if (top10.length > 0 && lyriaSession) {
    try {
      const maxCount = top10[0][1];
      const weightedPrompts = [
        ...top10.slice(0, 5).map(([word, count]) => ({
          text: word, weight: Math.max(1.0, (count / maxCount) * 3.0),
        })),
        ...top10.slice(5).map(([word]) => ({ text: word, weight: 0.4 })),
        ANCHOR_PROMPT,
      ];
      const preset = WORD_PRESETS[winner] ?? DEFAULT_PRESET;
      await lyriaSession.setWeightedPrompts({ weightedPrompts });
      await lyriaSession.setMusicGenerationConfig({
        musicGenerationConfig: { bpm: 118, ...preset },
      });
      console.log(`[Lyria] Updated → "${winner}" density:${preset.density} brightness:${preset.brightness}`);
    } catch (err) {
      console.error('[Lyria] Update failed:', err.message);
    }
  }

  console.log('[Panel] Result:', result);
  return result;
}

// ── Word-panel vote state ─────────────────────────────────────────────────────
let panelVotes = {};
let panelTimer = null;

const PANEL_BEAT_MS = Math.round(60000 / 118); // ≈ 508ms per beat

// ── Room & player state ───────────────────────────────────────────────────────
function generateRoomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

const currentRoomId = generateRoomId();
let hostSocket = null;
const players = new Map();

app.get('/room', (_req, res) => res.json({ roomId: currentRoomId }));

// ── Text Gen (Insults) ────────────────────────────────────────────────────────
const textClient = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

async function generateInsult(playerName) {
  if (!textClient) return "You missed the beat!";
  try {
    const response = await textClient.models.generateContent({
      model: 'gemini-3-flash-preview', // User provided API name for 3.0 flash preview
      contents: `Write a very short, funny, 1-sentence insult for a rhythm game player named ${playerName} who just missed a beat. Keep it clean but roasted. MAXIMUM 10 words.`,
    });
    return response.text;
  } catch (err) {
    if (err.message && err.message.includes("model not found")) {
      try {
        const fallback = await textClient.models.generateContent({
          model: 'gemini-1.5-flash',
          contents: `Write a very short, funny, 1-sentence insult for a rhythm game player named ${playerName} who just missed a beat. Keep it clean but roasted. MAXIMUM 10 words.`,
        });
        return fallback.text;
      } catch (e) {
        return "You completely missed the beat!";
      }
    }
    console.error('[Gemini Text] Error generating insult:', err.message);
    return "You missed the beat!";
  }
}

// ── Test endpoint: simulate a full vote panel with random votes ───────────────
app.get('/test-votes', (_req, res) => {
  if (!hostSocket) return res.json({ error: 'No host connected' });

  const duration = 4 * PANEL_BEAT_MS; // same as real panel
  const fakeUsers = 12; // simulated voters

  // Pick random words like real controllers would see (overlapping subsets)
  const roundWords = new Set();
  for (let i = 0; i < fakeUsers; i++) {
    pickRandom(LYRIA_WORD_POOL, WORDS_PER_USER).forEach(w => roundWords.add(w));
  }
  const wordList = [...roundWords];

  // Tell host panel is starting
  panelVotes = {};
  hostSocket.emit('panel_start', { words: wordList, duration });

  // Drip random votes in over the panel duration
  let sent = 0;
  const totalVotes = fakeUsers;
  const interval = Math.floor(duration / totalVotes);

  const drip = setInterval(async () => {
    if (sent >= totalVotes) {
      clearInterval(drip);
      await applyVoteResult({ ...panelVotes });
      panelVotes = {};
      return;
    }

    // Each fake user votes for a random word from the pool
    const word = wordList[Math.floor(Math.random() * wordList.length)];
    panelVotes[word] = (panelVotes[word] || 0) + 1;
    hostSocket.emit('vote_update', { votes: { ...panelVotes } });
    sent++;
  }, interval);

  res.json({ ok: true, words: wordList.length, voters: fakeUsers, duration });
});

// ── Lyria connection ──────────────────────────────────────────────────────────
async function connectLyria() {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[Lyria] No GEMINI_API_KEY — no music');
    return;
  }

  try {
    console.log('[Lyria] Connecting to Gemini...');
    const client = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
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
        { text: 'Disco Funk', weight: 2.0 },
        ANCHOR_PROMPT,
      ],
    });

    await lyriaSession.setMusicGenerationConfig({
      musicGenerationConfig: { bpm: 118, ...DEFAULT_PRESET },
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
        playerId: socket.id,
        direction: data.direction,
        timestamp: data.timestamp || Date.now(),
      });
    }
  });

  socket.on('player_missed', async ({ socketId, playerName }) => {
    // Generate an insult and send it back to the host, checking if host still exists
    if (hostSocket && socket.id === hostSocket.id) {
      const insult = await generateInsult(playerName);
      hostSocket.emit('player_insult', { socketId, insult });
    }
  });

  socket.on('player_color_assigned', ({ socketId, hexColor }) => {
    // Only the host should assign colors
    if (hostSocket && socket.id === hostSocket.id) {
      io.to(socketId).emit('set_color', { hexColor });
    }
  });

  socket.on('game_started', () => {
    if (hostSocket && socket.id === hostSocket.id) {
      io.emit('client_game_started');
    }
  });

  socket.on('game_ended', ({ losers }) => {
    if (hostSocket && socket.id === hostSocket.id) {
      io.emit('client_game_ended', { losers });
    }
  });

  // ── Word-panel: host triggers, each controller gets a different random subset
  socket.on('word_panel_start', () => {
    if (!hostSocket || socket.id !== hostSocket.id) return;

    panelVotes = {};
    if (panelTimer) { clearTimeout(panelTimer); panelTimer = null; }

    const duration = 4 * PANEL_BEAT_MS; // ≈ 2033ms

    // Send a different random subset to each controller, collect all round words
    const roundWords = new Set();
    players.forEach((_, sid) => {
      const words = pickRandom(LYRIA_WORD_POOL, WORDS_PER_USER);
      words.forEach(w => roundWords.add(w));
      io.to(sid).emit('show_word_panel', { words, duration });
    });

    // Tell host which words are in play this round
    if (hostSocket) hostSocket.emit('panel_start', { words: [...roundWords], duration });

    panelTimer = setTimeout(async () => {
      await applyVoteResult({ ...panelVotes });
      panelVotes = {};
      panelTimer = null;
    }, duration);
  });

  socket.on('vote', ({ word }) => {
    if (!players.has(socket.id) || !word) return;
    panelVotes[word] = (panelVotes[word] || 0) + 1;
    console.log(`[Vote] ${players.get(socket.id).name}: "${word}"`);
    // Live vote count update to host sidebar
    if (hostSocket) hostSocket.emit('vote_update', { votes: { ...panelVotes } });
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
