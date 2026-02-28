I want you to generate a full hackathon-ready project scaffold for a real-time multiplayer browser game.

PROJECT IDEA:

This is a multiplayer dancing rhythm game.

- A host computer runs the main game screen (big display).
- Players scan a QR code to join.
- Their phones act as controllers.
- Players press arrow buttons on their phone to “dance”.
- The host screen shows all players dancing in a shared arena.
- When players press buttons, their character animates.
- We are NOT adding any AI/LLM yet.
- No database needed.
- In-memory state only.
- Keep it simple and hackathon-friendly.

TECH STACK:

Backend:
- Node.js
- Express
- Socket.io
- ES modules (use `import`, not require)

Frontend:
- Host screen:
  - Phaser 3 for rendering the game
  - Socket.io client
- Controller screen (phones):
  - Plain HTML + CSS + JS
  - Socket.io client

ARCHITECTURE:

There should be:

/server.js
/public/index.html        (host screen)
/public/game.js           (Phaser logic)
/public/controller.html   (phone controller)

FUNCTIONAL REQUIREMENTS:

1. When server starts:
   - Generate a random 6-character room ID.
   - Expose GET /room endpoint returning { roomId }.
   - Serve static files from /public.

2. Host Screen (index.html + game.js):
   - On load:
     - Fetch /room
     - Display room ID
     - Generate QR code pointing to:
       /controller.html?roomId=ROOM_ID
   - Connect to Socket.io
   - Emit:
       register { role: "host", roomId }
   - Maintain a Map of players.
   - When receiving:
       "player_joined"
         → create a player sprite in Phaser at random position.
       "player_left"
         → remove sprite.
       "input"
         → animate that player (small scale bounce or flash).
   - Display player count on screen.
   - Dark neon dance vibe styling.
   - Simple animated background.
   - No music yet (just placeholder).

3. Controller Screen (controller.html):
   - Read roomId from query params.
   - Connect to Socket.io.
   - Emit:
       register { role: "controller", roomId }
   - Show 4 big arrow buttons:
       UP, DOWN, LEFT, RIGHT
   - When tapped:
       emit "input" with:
         {
           direction: "UP" | "DOWN" | "LEFT" | "RIGHT",
           timestamp: Date.now()
         }
   - Clean mobile-friendly UI.
   - No frameworks.

4. Server Behavior:

- Maintain:
    let hostSocket = null
    let players = Map()

- On socket "register":
    if role === "host":
        set hostSocket
    if role === "controller":
        add player to Map
        notify host:
            emit "player_joined" with:
                { id, totalPlayers }

- On controller disconnect:
    remove from Map
    notify host:
        emit "player_left"

- On "input" from controller:
    forward only to host:
        emit "input" with:
            { playerId, direction, timestamp }

5. General Constraints:

- No database.
- No authentication.
- No LLM.
- No overengineering.
- Keep everything readable.
- Add comments.
- Make it runnable with:
    npm install
    node server.js

6. Also include:

- package.json
- Clear instructions at top of server.js explaining how to run.

Keep everything simple and clean.
This is a hackathon prototype, not production software.