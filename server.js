const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    pingTimeout: 60000,
    pingInterval: 25000
});

app.use(express.static(path.join(__dirname, 'public')));

const games = {};

const NIGHT_DURATION_MS = 8 * 60 * 1000;
const HOUR_DURATION_MS = NIGHT_DURATION_MS / 6;
const MAX_POWER = 100;
const TICK_INTERVAL = 500;
const BASE_POWER_DRAIN = 0.033;
const CAMERA_POWER_DRAIN = 0.05;
const DOOR_POWER_DRAIN = 0.055;
const REBOOT_TIME = 15000;
const POWER_OUT_DEATH_TIME = 35000;
const DOOR_CLOSE_MS = 300;
const DOOR_OPEN_MS = 2000;

function createGame(settings) {
    const gameId = uuidv4().substring(0, 8).toUpperCase();
    const game = {
        id: gameId,
        settings: {
            mode: settings.mode || 1,
            doorCount: Math.min(3, Math.max(1, settings.doorCount || 2)),
            night: Math.min(7, Math.max(1, settings.night || 1))
        },
        state: 'lobby',
        power: MAX_POWER,
        hour: 0,
        timeStarted: null,
        camerasUp: false,
        currentCamera: 0,
        doors: [],
        cameras: [],
        animatronics: [],
        guardSocket: null,
        powerOutTime: null,
        systemOff: false,
        rebootInProgress: false,
        rebootApprovalNeeded: false,
        rebootStartTime: 0,
        phoneCallDone: false,
        creatorSocket: null
    };

    for (let i = 0; i < game.settings.doorCount; i++) {
        game.doors.push({
            id: i,
            closed: false,
            animating: false
        });
    }

    for (let i = 0; i < 8; i++) {
        game.cameras.push({
            connected: false,
            broken: false,
            repairing: false,
            repairStart: 0,
            socketId: null
        });
    }

    games[gameId] = game;
    return game;
}

function getGameHour(game) {
    if (!game.timeStarted) return 0;
    const elapsed = Date.now() - game.timeStarted;
    return Math.min(Math.floor(elapsed / HOUR_DURATION_MS), 6);
}

function getTimeString(hour) {
    if (hour === 0) return '12 AM';
    if (hour >= 6) return '6 AM';
    return hour + ' AM';
}

function getPowerDrain(game) {
    if (game.systemOff) return 0;
    let drain = BASE_POWER_DRAIN;
    if (game.camerasUp) drain += CAMERA_POWER_DRAIN;
    game.doors.forEach(d => {
        if (d.closed) drain += DOOR_POWER_DRAIN;
    });
    return drain;
}

function getConnectedCameraCount(game) {
    return game.cameras.filter(c => c.connected).length;
}

function getPublicState(game) {
    return {
        id: game.id,
        state: game.state,
        power: Math.max(0, Math.round(game.power * 10) / 10),
        hour: game.hour,
        hourString: getTimeString(game.hour),
        camerasUp: game.camerasUp,
        currentCamera: game.currentCamera,
        doors: game.doors.map(d => ({
            id: d.id,
            closed: d.closed,
            animating: d.animating
        })),
        cameras: game.cameras.map((c, i) => ({
            id: i,
            connected: c.connected,
            broken: c.broken,
            repairing: c.repairing
        })),
        animatronics: game.animatronics.map((a, i) => ({
            id: i,
            connected: a.connected,
            name: a.name
        })),
        mode: game.settings.mode,
        doorCount: game.settings.doorCount,
        night: game.settings.night,
        systemOff: game.systemOff,
        rebootInProgress: game.rebootInProgress,
        rebootApprovalNeeded: game.rebootApprovalNeeded,
        phoneCallDone: game.phoneCallDone,
        connectedCameras: getConnectedCameraCount(game)
    };
}

// Главный игровой цикл
setInterval(() => {
    Object.values(games).forEach(game => {
        if (game.state !== 'playing') return;

        const newHour = getGameHour(game);
        if (newHour !== game.hour) {
            game.hour = newHour;
            if (game.hour >= 6) {
                game.state = 'won';
                io.to('game_' + game.id).emit('gameWon', getPublicState(game));
                return;
            }
        }

        if (!game.systemOff && game.power > 0) {
            game.power -= getPowerDrain(game) * (TICK_INTERVAL / 1000);
            if (game.power <= 0) {
                game.power = 0;
                game.systemOff = true;
                game.camerasUp = false;
                game.doors.forEach(d => { d.closed = false; d.animating = false; });
                game.powerOutTime = Date.now();
                io.to('game_' + game.id).emit('powerOut', getPublicState(game));
            }
        }

        if (game.systemOff && game.powerOutTime && !game.rebootInProgress && !game.rebootApprovalNeeded) {
            if (Date.now() - game.powerOutTime > POWER_OUT_DEATH_TIME) {
                game.state = 'lost';
                io.to('game_' + game.id).emit('gameLost', {
                    ...getPublicState(game),
                    reason: 'power_out'
                });
                return;
            }
        }

        io.to('game_' + game.id).emit('gameState', getPublicState(game));
    });
}, TICK_INTERVAL);

io.on('connection', (socket) => {
    console.log('Connected:', socket.id);

    socket.on('createGame', (settings, callback) => {
        const game = createGame(settings);
        game.creatorSocket = socket.id;
        socket.join('game_' + game.id);
        socket.gameId = game.id;
        socket.role = 'creator';

        const links = {
            guard: `/guard.html?game=${game.id}`,
            cameras: [],
            animatronic: `/animatronic.html?game=${game.id}`
        };

        for (let i = 0; i < 8; i++) {
            links.cameras.push(`/camera.html?game=${game.id}&cam=${i}`);
        }

        game.animatronics.push({
            connected: false,
            socketId: null,
            name: 'Animatronic'
        });

        callback({
            success: true,
            gameId: game.id,
            links,
            state: getPublicState(game)
        });
    });

    socket.on('joinAsGuard', (gameId, callback) => {
        const game = games[gameId];
        if (!game) return callback({ success: false, error: 'Game not found' });

        game.guardSocket = socket.id;
        socket.join('game_' + gameId);
        socket.gameId = gameId;
        socket.role = 'guard';
        callback({ success: true, state: getPublicState(game) });
    });

    socket.on('joinAsCamera', ({ gameId, camIndex }, callback) => {
        const game = games[gameId];
        if (!game) return callback({ success: false, error: 'Game not found' });
        if (camIndex < 0 || camIndex >= 8) return callback({ success: false, error: 'Invalid camera index' });

        game.cameras[camIndex].connected = true;
        game.cameras[camIndex].socketId = socket.id;
        socket.join('game_' + gameId);
        socket.gameId = gameId;
        socket.role = 'camera';
        socket.camIndex = camIndex;

        io.to('game_' + gameId).emit('cameraConnected', {
            camIndex,
            state: getPublicState(game)
        });
        callback({ success: true, camIndex });
    });

    socket.on('joinAsAnimatronic', ({ gameId, name }, callback) => {
        const game = games[gameId];
        if (!game) return callback({ success: false, error: 'Game not found' });

        let idx = game.animatronics.findIndex(a => !a.connected);
        if (idx === -1) {
            game.animatronics.push({ connected: true, socketId: socket.id, name: name || 'Animatronic' });
            idx = game.animatronics.length - 1;
        } else {
            game.animatronics[idx].connected = true;
            game.animatronics[idx].socketId = socket.id;
            game.animatronics[idx].name = name || 'Animatronic';
        }

        socket.join('game_' + gameId);
        socket.gameId = gameId;
        socket.role = 'animatronic';
        socket.animIndex = idx;

        io.to('game_' + gameId).emit('animatronicConnected', {
            animIndex: idx,
            name,
            state: getPublicState(game)
        });
        callback({ success: true, animIndex: idx });
    });

    socket.on('startGame', (gameId) => {
        const game = games[gameId];
        if (!game) return;

        game.state = 'playing';
        game.timeStarted = Date.now();
        game.hour = 0;
        game.power = MAX_POWER;
        game.systemOff = false;
        game.camerasUp = false;
        game.currentCamera = 0;
        game.powerOutTime = null;
        game.rebootInProgress = false;
        game.rebootApprovalNeeded = false;
        game.phoneCallDone = false;
        game.doors.forEach(d => { d.closed = false; d.animating = false; });
        game.cameras.forEach(c => { c.broken = false; c.repairing = false; });

        io.to('game_' + gameId).emit('gameStarted', getPublicState(game));
    });

    socket.on('toggleCameras', (gameId) => {
        const game = games[gameId];
        if (!game || game.state !== 'playing' || game.systemOff) return;

        game.camerasUp = !game.camerasUp;
        io.to('game_' + gameId).emit('camerasToggled', {
            camerasUp: game.camerasUp,
            state: getPublicState(game)
        });
    });

    socket.on('switchCamera', ({ gameId, camIndex }) => {
        const game = games[gameId];
        if (!game || game.state !== 'playing' || game.systemOff || !game.camerasUp) return;
        if (camIndex < 0 || camIndex >= 8) return;

        game.currentCamera = camIndex;
        io.to('game_' + gameId).emit('cameraSwitched', {
            currentCamera: camIndex,
            state: getPublicState(game)
        });
    });

    socket.on('toggleDoor', ({ gameId, doorIndex }) => {
        const game = games[gameId];
        if (!game || game.state !== 'playing' || game.systemOff) return;
        if (doorIndex < 0 || doorIndex >= game.doors.length) return;

        const door = game.doors[doorIndex];
        if (door.animating) return;

        const wasOpen = !door.closed;
        door.closed = !door.closed;
        door.animating = true;

        const animTime = wasOpen ? DOOR_CLOSE_MS : DOOR_OPEN_MS;

        io.to('game_' + gameId).emit('doorToggled', {
            doorIndex,
            closed: door.closed,
            animTime,
            state: getPublicState(game)
        });

        setTimeout(() => {
            door.animating = false;
            io.to('game_' + gameId).emit('doorAnimDone', {
                doorIndex,
                state: getPublicState(game)
            });
        }, animTime);
    });

    socket.on('cameraFrame', ({ gameId, camIndex, frameData }) => {
        const game = games[gameId];
        if (!game) return;
        const cam = game.cameras[camIndex];
        if (!cam) return;

        if (game.camerasUp && game.currentCamera === camIndex && game.guardSocket && !cam.broken) {
            io.to(game.guardSocket).emit('cameraFrame', {
                camIndex,
                frameData,
                broken: cam.broken
            });
        }
    });

    // Аниматроник ломает камеру
    socket.on('breakCamera', ({ gameId, camIndex }) => {
        const game = games[gameId];
        if (!game || game.state !== 'playing') return;
        const cam = game.cameras[camIndex];
        if (!cam || !cam.connected) return;

        cam.broken = true;
        cam.repairing = false;

        if (cam.socketId) {
            io.to(cam.socketId).emit('cameraBroken');
        }
        io.to('game_' + gameId).emit('cameraBrokenNotify', {
            camIndex,
            state: getPublicState(game)
        });
    });

    // Камера САМА себя чинит (с телефона камеры, не с охранника!)
    socket.on('startRepairCamera', ({ gameId, camIndex }) => {
        const game = games[gameId];
        if (!game || game.state !== 'playing') return;
        const cam = game.cameras[camIndex];
        if (!cam || !cam.broken || cam.repairing) return;
        // Проверяем что это сокет самой камеры
        if (cam.socketId !== socket.id) return;

        cam.repairing = true;
        cam.repairStart = Date.now();

        io.to('game_' + gameId).emit('cameraRepairing', {
            camIndex,
            state: getPublicState(game)
        });

        setTimeout(() => {
            if (game.state !== 'playing') return;
            if (!cam.broken) return; // Уже починена
            cam.broken = false;
            cam.repairing = false;

            if (cam.socketId) {
                io.to(cam.socketId).emit('cameraRepaired');
            }
            io.to('game_' + gameId).emit('cameraRepairedNotify', {
                camIndex,
                state: getPublicState(game)
            });
        }, 20000);
    });

    socket.on('killPower', ({ gameId }) => {
        const game = games[gameId];
        if (!game || game.state !== 'playing' || game.systemOff) return;

        game.power = 0;
        game.systemOff = true;
        game.camerasUp = false;
        game.doors.forEach(d => { d.closed = false; d.animating = false; });
        game.powerOutTime = Date.now();

        io.to('game_' + gameId).emit('powerOut', getPublicState(game));
    });

    socket.on('startReboot', (gameId) => {
        const game = games[gameId];
        if (!game || game.state !== 'playing' || !game.systemOff) return;
        if (game.rebootInProgress) return;

        game.rebootInProgress = true;
        game.rebootStartTime = Date.now();

        io.to('game_' + gameId).emit('rebootStarted', getPublicState(game));

        setTimeout(() => {
            if (game.state !== 'playing') return;
            game.rebootApprovalNeeded = true;
            io.to('game_' + gameId).emit('rebootWaitingApproval', getPublicState(game));
        }, REBOOT_TIME);
    });

    socket.on('approveReboot', ({ gameId }) => {
        const game = games[gameId];
        if (!game || game.state !== 'playing') return;

        game.systemOff = false;
        game.rebootInProgress = false;
        game.rebootApprovalNeeded = false;
        game.powerOutTime = null;
        game.power = 30;

        io.to('game_' + gameId).emit('rebootApproved', getPublicState(game));
    });

    socket.on('denyReboot', ({ gameId }) => {
        const game = games[gameId];
        if (!game || game.state !== 'playing') return;

        game.rebootInProgress = false;
        game.rebootApprovalNeeded = false;

        io.to('game_' + gameId).emit('rebootDenied', getPublicState(game));
    });

    socket.on('jumpscare', ({ gameId }) => {
        const game = games[gameId];
        if (!game || game.state !== 'playing') return;

        game.state = 'lost';
        io.to('game_' + gameId).emit('gameLost', {
            ...getPublicState(game),
            reason: 'jumpscare'
        });
    });

    socket.on('phoneCallDone', (gameId) => {
        const game = games[gameId];
        if (game) game.phoneCallDone = true;
    });

    socket.on('disconnect', () => {
        console.log('Disconnected:', socket.id);
        if (!socket.gameId || !games[socket.gameId]) return;
        const game = games[socket.gameId];

        if (socket.role === 'camera' && typeof socket.camIndex === 'number') {
            const cam = game.cameras[socket.camIndex];
            if (cam) {
                cam.connected = false;
                cam.socketId = null;
            }
        }
        if (socket.role === 'animatronic' && typeof socket.animIndex === 'number') {
            const a = game.animatronics[socket.animIndex];
            if (a) {
                a.connected = false;
                a.socketId = null;
            }
        }
        io.to('game_' + game.id).emit('gameState', getPublicState(game));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`FNAF Server on port ${PORT}`);
    console.log(`http://localhost:${PORT}`);
});