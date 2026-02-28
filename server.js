import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Instructions ---
// To run this hackathon prototype:
// 1. npm install
// 2. node server.js
// 3. Open http://localhost:3000 in a browser for the Host Screen.
// -------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// State
let hostSocket = null;
const players = new Map();

// Helper to generate a 6-character room ID
function generateRoomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

const currentRoomId = generateRoomId();

// Middleware
app.use(express.static(path.join(__dirname, 'public')));

// API Endpoint for the host to get the room ID
app.get('/room', (req, res) => {
  res.json({ roomId: currentRoomId });
});

// Socket.io logic
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Registration
  socket.on('register', (data) => {
    const { role, roomId, name } = data;

    // For simplicity, we only enforce matching the current room ID loosely
    if (roomId !== currentRoomId) {
      console.log(`Warning: Socket ${socket.id} presented mismatched roomId ${roomId}`);
    }

    if (role === 'host') {
      console.log(`Host registered: ${socket.id}`);
      hostSocket = socket;

      // Send any already registered players to the newly connected host
      players.forEach((p, id) => {
        hostSocket.emit('player_joined', {
          id: p.id,
          name: p.name,
          totalPlayers: players.size
        });
      });
    } else if (role === 'controller') {
      console.log(`Player registered: ${socket.id} as ${name || 'Unknown'}`);
      players.set(socket.id, { id: socket.id, name: name || 'Player' });

      // Notify host that a player joined
      if (hostSocket) {
        hostSocket.emit('player_joined', {
          id: socket.id,
          name: name || 'Player',
          totalPlayers: players.size
        });
      }
    }
  });

  // Handle input from controllers
  socket.on('input', (data) => {
    // Only forward if it comes from a registered player
    if (players.has(socket.id) && hostSocket) {
      // Forward the input directly to the host
      hostSocket.emit('input', {
        playerId: socket.id,
        direction: data.direction,
        timestamp: data.timestamp || Date.now()
      });
    }
  });

  // Disconnection
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);

    if (hostSocket && socket.id === hostSocket.id) {
      console.log('Host disconnected.');
      hostSocket = null;
    } else if (players.has(socket.id)) {
      console.log(`Player disconnected: ${socket.id}`);
      players.delete(socket.id);

      // Notify host a player left
      if (hostSocket) {
        hostSocket.emit('player_left', {
          id: socket.id,
          totalPlayers: players.size
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🚀 Beat Drop Server running on port ${PORT}`);
  console.log(`===============================================`);
});
