// Host Screen Game Logic

// Connect to the local Socket.io server
const socket = io();

const roomIdDisplay = document.getElementById('room-id-display');
const playerCountDisplay = document.getElementById('player-count');
const qrContainer = document.getElementById('qr-container');

let players = {}; // Map socket.id -> Phaser Sprite

const BPM = 118;
const BEAT_MS = 60000 / BPM;  // ≈ 508ms per beat
const TURN_BEATS = 8;            // 2 bars of 4/4 — aligns with Lyria's 118 BPM output

// 1. Fetch Room ID and Setup QR Code
async function initializeRoom() {
    try {
        const response = await fetch('/room');
        const data = await response.json();
        const roomId = data.roomId;

        // Display Room ID
        roomIdDisplay.innerText = roomId;

        // Generate URL for controllers
        const controllerUrl = `${window.location.origin}/controller.html?roomId=${roomId}`;

        // Generate QR Code
        new QRCode(qrContainer, {
            text: controllerUrl,
            width: 80,
            height: 80,
            colorDark: "#0b0c10",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.L
        });

        // Register with Socket Server
        socket.emit('register', { role: 'host', roomId: roomId });

    } catch (err) {
        console.error("Failed to initialize room:", err);
        roomIdDisplay.innerText = "ERR";
    }
}

initializeRoom();

// 2. Socket.io Event Listeners (Logic handled inside Phaser Scene)
socket.on('player_joined', (data) => {
    console.log("Player joined:", data.id, data.name);
    playerCountDisplay.innerText = data.totalPlayers;
    if (gameScene) gameScene.addPlayer(data.id, data.name);
});

socket.on('player_left', (data) => {
    console.log("Player left:", data.id);
    playerCountDisplay.innerText = data.totalPlayers;
    if (gameScene) gameScene.removePlayer(data.id);
});

socket.on('input', (data) => {
    // data: { playerId, direction, timestamp }
    if (gameScene) gameScene.handleInput(data);
});

socket.on('player_insult', ({ socketId, insult }) => {
    if (window.gameScene) window.gameScene.showInsult(socketId, insult);
});

socket.on('word_panel_result', ({ winner, votes }) => {
    if (winner && window.gameScene) window.gameScene.showWordResult(winner);
    window.dispatchEvent(new CustomEvent('lyria_panel_result', { detail: { winner, votes } }));
    // Chain: schedule next vote 2 turns (16 beats) after this result
    if (window.gameScene) window.gameScene.scheduleNextVote();
});

socket.on('match_summary', ({ summary }) => {
    const summaryDiv = document.getElementById('match-summary');
    if (summaryDiv) {
        // Strip markdown bolding and asterisks
        summaryDiv.innerText = `"${summary.replace(/[\*\_~]/g, '')}"`;
    }
});

// Bridge socket events to window — vibe-sidebar.js listens here
socket.on('panel_start', (data) => window.dispatchEvent(new CustomEvent('lyria_panel_start', { detail: data })));
socket.on('vote_update', (data) => window.dispatchEvent(new CustomEvent('lyria_vote_update', { detail: data })));

// ── Web Audio — stream Lyria PCM from server ──────────────────────────────────
// Raw PCM: 16-bit signed, 48kHz, stereo interleaved (L R L R ...)
let audioCtx = null;
let nextPlayTime = 0;

function ensureAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
        nextPlayTime = audioCtx.currentTime + 0.1;
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

socket.on('audio_chunk', (b64) => {
    ensureAudio();
    try {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const int16 = new Int16Array(bytes.buffer);
        const frameCount = Math.floor(int16.length / 2);
        const buf = audioCtx.createBuffer(2, frameCount, 48000);
        const L = buf.getChannelData(0);
        const R = buf.getChannelData(1);
        for (let i = 0; i < frameCount; i++) {
            L[i] = int16[i * 2] / 32768;
            R[i] = int16[i * 2 + 1] / 32768;
        }

        const startAt = Math.max(nextPlayTime, audioCtx.currentTime + 0.02);
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(audioCtx.destination);
        src.start(startAt);
        nextPlayTime = startAt + buf.duration;
    } catch (e) {
        console.warn('[Audio] chunk error:', e.message);
    }
});

// Unlock AudioContext on first interaction
document.addEventListener('click', ensureAudio, { once: true });
document.addEventListener('keydown', ensureAudio, { once: true });


// 3. Phaser Game Configuration
class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
        // Green, Blue, Purple, Yellow, Orange/Red
        this.colors = [0x00ff66, 0x00f3ff, 0xa100ff, 0xffea00, 0xff0044];
        this.gameStarted = false;

        this.turnDuration = TURN_BEATS * BEAT_MS; // 8 beats ≈ 4067ms, aligned to 118 BPM
        this.turnTimer = null;

        this.currentSequence = [];
        this.sequenceSprites = [];

        // Define lane symbols
        this.symbols = {
            'LEFT': '⬅️',
            'DOWN': '⬇️',
            'UP': '⬆️',
            'RIGHT': '➡️'
        };

        this.beatBarX = 200;
        this.beatBarY = 500;
        this.beatBarWidth = 400;

        // The Hit Zone is the last 15% of the bar
        this.hitZoneStart = 0.85;
        this.hitZoneEnd = 0.95;
    }

    preload() {
        // Preload the 5 character sprites
        for (let i = 1; i <= 5; i++) {
            this.load.image(`char${i}`, `chars/char${i}.png`);
        }
    }

    create() {
        // Background grid
        this.grid = this.add.grid(
            this.cameras.main.width / 2,
            this.cameras.main.height / 2,
            this.cameras.main.width,
            this.cameras.main.height,
            64, 64,
            0x050508, 1, 0x1f2833, 0.2
        );

        // Animated background pulse
        this.bgPulse = this.add.rectangle(400, 300, 800, 600, 0x00f3ff, 0).setDepth(-1);
        this.tweens.add({ targets: this.bgPulse, alpha: 0.05, duration: 2000, yoyo: true, repeat: -1 });

        // --- Beat Bar UI ---
        this.beatBarBg = this.add.rectangle(this.beatBarX, this.beatBarY, this.beatBarWidth, 20, 0x1f2833).setOrigin(0, 0.5);
        this.beatBarBg.setStrokeStyle(2, 0x45a29e);

        // The Sliding Playhead
        this.playhead = this.add.circle(this.beatBarX, this.beatBarY, 15, 0xff0044);

        // Sequence Container (Center)
        this.sequenceText = this.add.text(400, 420, '', {
            fontSize: '48px', color: '#ffffff', fontFamily: 'sans-serif'
        }).setOrigin(0.5, 0.5);

        // Edge Glow Vignette
        const vignette = this.add.rectangle(400, 300, 800, 600, 0x000000, 0).setDepth(100);
        vignette.setStrokeStyle(40, 0x000000, 0.7);

        // Particle Manager for the burst effect
        this.particles = this.add.particles(0, 0, 'flare', {
            speed: { min: 100, max: 300 },
            angle: { min: 0, max: 360 },
            scale: { start: 0.5, end: 0 },
            blendMode: 'ADD',
            lifespan: 600,
            emitting: false
        });

        // We'll generate a simple white circle texture for the particles to use
        const graphics = this.add.graphics();
        graphics.fillStyle(0xffffff, 1);
        graphics.fillCircle(8, 8, 8);
        graphics.generateTexture('flare', 16, 16);
        graphics.destroy();

        // Start game on click (HTML overlay)
        document.getElementById('waiting-overlay').addEventListener('click', () => {
            if (!this.gameStarted) this.startGame();
        });

        window.gameScene = this;
    }

    startGame() {
        if (Object.keys(players).length === 0) {
            const hint = document.querySelector('.click-start');
            if (hint) hint.innerText = "WAITING FOR PLAYERS (Need at least 1!)";
            return;
        }

        this.gameStarted = true;

        const overlay = document.getElementById('waiting-overlay');
        if (overlay) {
            overlay.style.opacity = '0';
            setTimeout(() => overlay.style.display = 'none', 500);
        }

        socket.emit('game_started'); // Reset controllers UI

        // Reset all player scores for a fresh game
        Object.values(players).forEach(p => {
            p.score = 0;
            p.combo = 0;
            if (p.ui && p.ui.scoreText) p.ui.scoreText.setText("0");
        });
        this.updateScoreboard();

        // Audio is streamed from Lyria via Web Audio — no video element needed
        ensureAudio();

        // 45 second game timer
        if (this.gameTimer) this.gameTimer.destroy();
        this.gameTimer = this.time.addEvent({
            delay: 45000,
            callback: this.endGame,
            callbackScope: this
        });

        // UI countdown timer tick
        this.secondsRemaining = 45;
        const timerDisplay = document.getElementById('timer-display');
        if (timerDisplay) timerDisplay.innerText = this.secondsRemaining;

        if (this.uiTimer) this.uiTimer.destroy();
        this.uiTimer = this.time.addEvent({
            delay: 1000,
            loop: true,
            callback: () => {
                this.secondsRemaining--;
                if (this.secondsRemaining >= 0 && timerDisplay) {
                    timerDisplay.innerText = this.secondsRemaining;
                }
            }
        });

        // First vote fires after 2 turns (16 beats); subsequent votes chain from result
        if (this.wordPanelTimer) { this.wordPanelTimer.destroy(); this.wordPanelTimer = null; }
        this.wordPanelTimer = this.time.delayedCall(2 * TURN_BEATS * BEAT_MS, () => {
            if (this.gameStarted) socket.emit('word_panel_start');
        });

        this.startNextTurn();
    }

    scheduleNextVote() {
        if (!this.gameStarted) return;
        if (this.wordPanelTimer) { this.wordPanelTimer.destroy(); this.wordPanelTimer = null; }
        this.wordPanelTimer = this.time.delayedCall(2 * TURN_BEATS * BEAT_MS, () => {
            if (this.gameStarted) socket.emit('word_panel_start');
        });
    }

    endGame() {
        this.gameStarted = false;

        if (this.turnTween) {
            this.turnTween.stop();
            this.turnTween = null;
        }

        if (this.wordPanelTimer) { this.wordPanelTimer.destroy(); this.wordPanelTimer = null; }

        if (this.uiTimer) {
            this.uiTimer.destroy();
            this.uiTimer = null;
        }

        const timerDisplay = document.getElementById('timer-display');
        if (timerDisplay) timerDisplay.innerText = '0';

        // Find losers (lowest score)
        let lowestScore = Infinity;
        let losers = [];
        Object.values(players).forEach(p => {
            if (p.score < lowestScore) {
                lowestScore = p.score;
                losers = [p.id];
            } else if (p.score === lowestScore) {
                losers.push(p.id);
            }
        });

        socket.emit('game_ended', { losers });

        // Show Game Over UI
        const overlay = document.getElementById('waiting-overlay');
        if (overlay) {
            const title = overlay.querySelector('.waiting-title');
            if (title) title.innerText = "GAME OVER";

            const sub = overlay.querySelector('.waiting-subtitle');
            if (sub) sub.innerText = "LOSER PAYS THE PRICE";

            const summaryDiv = document.getElementById('match-summary');
            if (summaryDiv) summaryDiv.innerText = "DJ is generating the match recap...";

            const clickHint = overlay.querySelector('.click-start');
            if (clickHint) clickHint.innerText = "CLICK ANYWHERE TO REPLAY";

            overlay.style.display = 'flex';
            overlay.style.opacity = '1';
        }
    }

    startNextTurn() {
        // Reset players
        Object.values(players).forEach(p => {
            p.sequenceProgress = 0;
            p.failedTurn = false;
            p.finishedTurn = false;
            p.ui.sprite.clearTint();
            p.ui.sprite.setScale(p.ui.baseScale); // Return to their base scale
            p.ui.sprite.setAngle(0);
        });

        // Generate a sequence of 5 arrows
        const directions = ['LEFT', 'DOWN', 'UP', 'RIGHT'];
        this.currentSequence = [];
        let seqStr = '';
        for (let i = 0; i < 5; i++) {
            const dir = Phaser.Math.RND.pick(directions);
            this.currentSequence.push(dir);
            seqStr += this.symbols[dir] + ' ';
        }

        this.sequenceText.setText(seqStr.trim());

        // Flash text to indicate new turn
        this.tweens.add({ targets: this.sequenceText, scale: 1.2, duration: 150, yoyo: true });

        // Reset and start playhead animation
        this.playhead.x = this.beatBarX;

        if (this.turnTween) {
            this.turnTween.stop();
            this.turnTween = null;
        }

        this.turnTween = this.tweens.add({
            targets: this.playhead,
            x: this.beatBarX + this.beatBarWidth,
            duration: this.turnDuration,
            ease: 'Linear',
            onComplete: () => {
                this.evaluateMisses();
                // Delay next turn slightly to avoid tween loop iteration conflicts in Phaser
                this.time.delayedCall(50, () => {
                    this.startNextTurn();
                });
            }
        });
    }

    evaluateMisses() {
        if (!this.gameStarted) return;
        // Anyone who didn't finish FAILS the turn
        Object.values(players).forEach(player => {
            if (!player.finishedTurn && !player.failedTurn) {
                player.failedTurn = true;
                this.showFeedback(player, 'MISS!', 0xff0000);
                // socket.emit('player_missed', { socketId: player.id, playerName: player.name });
            }
        });
    }

    updateScoreboard() {
        // Sort players by score descending
        const sortedPlayers = Object.values(players).sort((a, b) => b.score - a.score);
        const listContainer = document.getElementById('leaderboard-list');
        if (!listContainer) return;

        listContainer.innerHTML = '';

        sortedPlayers.forEach((p, index) => {
            const row = document.createElement('div');
            row.className = `player-row ${index === 0 ? 'rank-1' : ''}`;

            if (index !== 0) {
                row.style.color = this.numberToHex(p.color);
                row.style.borderColor = this.numberToHex(p.color);
            }

            const nameEl = document.createElement('div');
            nameEl.className = 'player-name';
            nameEl.textContent = `#${index + 1} ${p.name.substring(0, 8)}`;

            const scoreEl = document.createElement('div');
            scoreEl.className = 'player-score';
            scoreEl.textContent = `${p.score} PTS`;

            row.appendChild(nameEl);
            row.appendChild(scoreEl);
            listContainer.appendChild(row);
        });
    }

    numberToHex(num) {
        return '#' + num.toString(16).padStart(6, '0');
    }

    update(time, delta) {
        this.grid.tilePositionY -= 0.5;
    }

    getAvailableCharIndex() {
        // Find which char indices 1-5 are NOT currently used
        const usedIndices = Object.values(players).map(p => p.charIndex);
        for (let i = 1; i <= 5; i++) {
            if (!usedIndices.includes(i)) return i;
        }
        return 1; // Fallback
    }

    addPlayer(id, name) {
        if (players[id]) return; // Prevent duplicate instantiation

        if (Object.keys(players).length >= 5) {
            console.log("Room full, cannot add more than 5 players.");
            return;
        }

        const charIndex = this.getAvailableCharIndex();

        // Spread players across 5 fixed positions to prevent overlapping
        const xPositions = [150, 275, 400, 525, 650];
        const yPositions = [280, 230, 300, 230, 280];

        const x = xPositions[charIndex - 1] || Phaser.Math.Between(150, 650);
        const y = yPositions[charIndex - 1] || Phaser.Math.Between(200, 300);

        // Assign color based on charIndex so they never repeat unless > 6 players
        const color = this.colors[(charIndex - 1) % this.colors.length];

        // Glowing Platform (color matches player's assigned color)
        const platform = this.add.ellipse(x, y + 60, 80, 25, color, 0.2);
        platform.setStrokeStyle(2, color, 0.5);


        // Player Sprite (Image)
        const sprite = this.add.sprite(x, y, `char${charIndex}`);

        // Scale down the sprite if it's too large naturally
        const targetHeight = 130;
        const scale = targetHeight / sprite.height;
        sprite.setScale(scale);

        // Player Name Tag above sprite
        const nameTag = this.add.text(x, y - (sprite.height * scale / 2) - 15, name || 'Player', { fontFamily: 'Rajdhani', fontSize: '18px', color: '#ffffff', backgroundColor: '#000000', padding: { x: 4, y: 2 } }).setOrigin(0.5);

        // Idle floating tween
        this.tweens.add({
            targets: sprite, y: y - 10, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
        });

        players[id] = {
            id,
            name: name || 'Player',
            score: 0,
            color,
            charIndex,
            sequenceProgress: 0,
            failedTurn: false,
            finishedTurn: false,
            ui: { sprite, platform, nameTag, baseScale: scale, baseY: y }
        };

        // Convert 0xff0000 format to #ff0000 for CSS
        const hexColor = '#' + color.toString(16).padStart(6, '0');
        socket.emit('player_color_assigned', { socketId: id, hexColor });

        // If game is already started, ensure they see the current sequence
        if (this.gameStarted && this.currentSequence.length > 0) {
            this.sequenceText.setText(this.currentSequence.map(d => this.symbols[d]).join(' '));
        }

        this.updateScoreboard();
    }

    removePlayer(id) {
        if (players[id]) {
            const p = players[id];
            p.ui.sprite.destroy();
            p.ui.platform.destroy();
            p.ui.nameTag.destroy();
            delete players[id];
            this.updateScoreboard();
        }
    }

    handleInput(data) {
        const { playerId, direction } = data;
        const player = players[playerId];
        if (!player || !this.gameStarted) return;

        // Visual feedback of what they pressed
        const symbol = this.symbols[direction] || '💥';
        const flashText = this.add.text(player.ui.sprite.x, player.ui.sprite.y - 40, symbol, { fontSize: '30px' }).setOrigin(0.5);
        this.tweens.add({ targets: flashText, y: player.ui.sprite.y - 80, alpha: 0, duration: 400, onComplete: () => flashText.destroy() });

        // Transform-Based Input Animation
        const bY = player.ui.baseY;
        const bS = player.ui.baseScale;

        // Clear conflicting tweens on this sprite easily
        this.tweens.killTweensOf(player.ui.sprite);

        if (direction === 'LEFT') {
            this.tweens.add({ targets: player.ui.sprite, angle: -10, duration: 150, yoyo: true, onComplete: () => player.ui.sprite.setAngle(0) });
        } else if (direction === 'RIGHT') {
            this.tweens.add({ targets: player.ui.sprite, angle: 10, duration: 150, yoyo: true, onComplete: () => player.ui.sprite.setAngle(0) });
        } else if (direction === 'UP') {
            this.tweens.add({
                targets: player.ui.sprite, y: bY - 30, scaleY: bS * 1.1, scaleX: bS * 0.9, duration: 150, yoyo: true, onComplete: () => {
                    player.ui.sprite.y = bY;
                    player.ui.sprite.setScale(bS);
                }
            });
        } else if (direction === 'DOWN') {
            this.tweens.add({
                targets: player.ui.sprite, y: bY + 15, scaleY: bS * 0.8, scaleX: bS * 1.2, duration: 150, yoyo: true, onComplete: () => {
                    player.ui.sprite.y = bY;
                    player.ui.sprite.setScale(bS);
                }
            });
        }

        // If turn already resolved for this player, ignore
        if (player.failedTurn || player.finishedTurn) return;

        // Handle Sequence Input
        const expectedDirection = this.currentSequence[player.sequenceProgress];

        if (direction === expectedDirection) {
            // Correct input
            player.sequenceProgress++;
            player.ui.sprite.setTint(0xaaaaaa); // Slight visual cue

            if (player.sequenceProgress === this.currentSequence.length) {
                // Sequence complete!
                player.score += 500;
                player.finishedTurn = true;
                player.ui.sprite.clearTint();

                // 1. Neon glow pulse
                player.ui.sprite.setTintFill(0xaaffaa);
                this.time.delayedCall(150, () => {
                    if (player && player.ui && player.ui.sprite) {
                        player.ui.sprite.clearTint();
                    }
                });

                this.showFeedback(player, 'PERFECT!', 0x00ff00);

                // 2. Particle Burst
                this.particles.emitParticleAt(player.ui.sprite.x, player.ui.sprite.y, 30);

                // 3. Ground Ripple (Expanding ring)
                const ripple = this.add.circle(player.ui.sprite.x, player.ui.sprite.y + (player.ui.sprite.height * player.ui.baseScale / 2), 10);
                ripple.setStrokeStyle(4, 0x66fcf1);
                this.tweens.add({
                    targets: ripple,
                    radius: 100,
                    alpha: 0,
                    duration: 500,
                    ease: 'Cubic.easeOut',
                    onComplete: () => ripple.destroy()
                });

                // 4. Big exaggerated squash (Static execution)
                this.tweens.add({
                    targets: player.ui.sprite,
                    y: player.ui.baseY + 20,
                    scaleX: player.ui.baseScale * 1.5,
                    scaleY: player.ui.baseScale * 0.5,
                    duration: 100,
                    yoyo: true,
                    onComplete: () => {
                        player.ui.sprite.y = player.ui.baseY;
                        player.ui.sprite.setScale(player.ui.baseScale);
                    }
                });

                // 5. Camera Punch
                this.cameras.main.shake(150, 0.01);
                this.cameras.main.flash(100, 255, 255, 255, 0.2); // slight white flash covering screen

                this.updateScoreboard();
            }
        } else {
            // Wrong input!
            player.failedTurn = true;
            player.ui.sprite.setTint(0x444444);
            this.showFeedback(player, 'WRONG MOVE!', 0xff0000);
            // socket.emit('player_missed', { socketId: player.id, playerName: player.name });
        }
    }

    showWordResult(word) {
        const banner = this.add.text(400, 55, `♪  "${word}"  wins the vibe!`, {
            fontSize: '22px', color: '#66fcf1', fontStyle: 'bold',
            backgroundColor: '#0b0c10cc', padding: { x: 14, y: 6 },
        }).setOrigin(0.5).setDepth(10);

        this.tweens.add({
            targets: banner, alpha: 0, duration: 1000, delay: 2000,
            onComplete: () => banner.destroy(),
        });
    }

    showInsult(socketId, insult) {
        const player = players[socketId];
        if (!player) return;

        const px = player.ui.sprite.x;
        const py = player.ui.sprite.y - 100;

        const textObj = this.add.text(px, py, insult, {
            fontSize: '20px', color: '#ff007f', fontStyle: 'bold',
            backgroundColor: '#000000dd', padding: { x: 12, y: 12 },
            align: 'center', wordWrap: { width: 300 }
        }).setOrigin(0.5, 1).setDepth(50); // anchored bottom center

        textObj.setStroke('#ff007f', 1.5);

        this.tweens.add({
            targets: textObj,
            y: py - 25,
            alpha: { from: 1, to: 0 },
            duration: 6000,
            ease: 'Power2',
            onComplete: () => textObj.destroy()
        });
    }

    showFeedback(player, text, colorCode) {
        const px = player.ui.sprite.x;
        const py = player.ui.sprite.y;

        const feedback = this.add.text(px, py - 30, text, {
            fontSize: '20px', color: this.numberToHex(colorCode), fontStyle: 'bold'
        }).setOrigin(0.5, 0.5);

        this.tweens.add({
            targets: feedback, y: py - 80, alpha: 0, duration: 800, onComplete: () => feedback.destroy()
        });

        if (colorCode === 0xff0000) {
            this.cameras.main.shake(100, 0.005); // slight shake penalty
        }
    }
}

// Ensure the variable is globally available early for async events
window.gameScene = null;

const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    parent: 'game-container',
    backgroundColor: '#0b0c10',
    scene: GameScene
};

const game = new Phaser.Game(config);
