// Host Screen Game Logic

// Connect to the local Socket.io server
const socket = io();

const roomIdDisplay = document.getElementById('room-id-display');
const playerCountDisplay = document.getElementById('player-count');
const qrContainer = document.getElementById('qr-container');

let players = {}; // Map socket.id -> Phaser Sprite

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
    console.log("Player joined:", data.id);
    playerCountDisplay.innerText = data.totalPlayers;
    if (gameScene) gameScene.addPlayer(data.id);
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


// 3. Phaser Game Configuration
class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
        this.colors = [0xff0044, 0x00ff00, 0x0044ff, 0xffff00, 0xff00ff, 0x00ffff];
    }

    preload() {
        // No assets to load, we'll draw shapes
    }

    create() {
        // Simple animated background grid
        this.grid = this.add.grid(
            this.cameras.main.width / 2,
            this.cameras.main.height / 2,
            this.cameras.main.width,
            this.cameras.main.height,
            64, 64,
            0x0b0c10, 1, 0x1f2833, 0.5
        );

        // Store reference globally so socket events can access it easily
        window.gameScene = this;
    }

    update(time, delta) {
        // Slowly move grid down to simulate moving forward
        this.grid.tilePositionY -= 0.5;
    }

    addPlayer(id) {
        // Random position within safe bounds
        const x = Phaser.Math.Between(100, this.cameras.main.width - 100);
        const y = Phaser.Math.Between(100, this.cameras.main.height - 100);
        const color = Phaser.Math.RND.pick(this.colors);

        // Create a simple rectangle representing the player
        const sprite = this.add.rectangle(x, y, 40, 80, color);
        sprite.setStrokeStyle(4, 0xffffff);

        // Add a pulsing effect to show they are alive
        this.tweens.add({
            targets: sprite,
            scaleY: 1.1,
            scaleX: 1.05,
            duration: 500,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        players[id] = sprite;
    }

    removePlayer(id) {
        if (players[id]) {
            players[id].destroy();
            delete players[id];
        }
    }

    handleInput(data) {
        const { playerId, direction } = data;
        const sprite = players[playerId];

        if (!sprite) return;

        // Stop current tweens to prevent weird overlapping animations
        this.tweens.killTweensOf(sprite);

        // Reset scale and flip
        sprite.setScale(1);
        sprite.angle = 0;

        let targetY = sprite.y;
        let targetAngle = 0;

        // Determine animation based on input direction
        switch (direction) {
            case 'UP':
                targetY -= 30;
                break;
            case 'DOWN':
                targetY += 30;
                break;
            case 'LEFT':
                targetAngle = -25;
                break;
            case 'RIGHT':
                targetAngle = 25;
                break;
        }

        // Play "Dance Move" animation
        this.tweens.add({
            targets: sprite,
            y: targetY,
            angle: targetAngle,
            scale: 1.2,
            duration: 150,
            yoyo: true,
            ease: 'Cubic.easeOut',
            onComplete: () => {
                // Resume idle pulsing after move
                this.tweens.add({
                    targets: sprite,
                    scaleY: 1.1,
                    scaleX: 1.05,
                    duration: 500,
                    yoyo: true,
                    repeat: -1,
                    ease: 'Sine.easeInOut'
                });
            }
        });

        // Add visual flash effect on the ground/background behind them
        const flash = this.add.circle(sprite.x, sprite.y, 60, sprite.fillColor, 0.4);
        this.tweens.add({
            targets: flash,
            scale: 2,
            alpha: 0,
            duration: 300,
            onComplete: () => flash.destroy()
        });
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
