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

// ===== НАСТРОЙКИ ВРЕМЕНИ И ЭНЕРГИИ =====
const HOUR_DURATION_MS = 4 * 60 * 1000; // 1 час = 4 минуты (240 000 мс)
const MAX_POWER = 100;
const TICK_INTERVAL = 500; // Проверка каждые 0.5 сек

// Баланс расхода (в % в секунду)
const BASE_POWER_DRAIN = 0.025;   // Пассивный расход (хватит на ~66 минут)
const CAMERA_POWER_DRAIN = 0.020; // Камеры
const DOOR_POWER_DRAIN = 0.057;   // За КАЖДУЮ закрытую дверь (2 двери = смерть в 3 AM)

const REBOOT_TIME = 15000; // 15 сек на перезагрузку
const POWER_OUT_DEATH_TIME = 35000; // 35 сек до скримера после отключения света
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
        powerAtOut: MAX_POWER, // Запоминаем энергию перед отключением аниматроником
        hour: 0,
        activePlayTimeMs: 0,
        lastTickTime: null,
        camerasUp: false,
        currentCamera: 0,
        doors: [],
        cameras: [],
        animatronics: [],
        guardSocket: null,
        powerOutTime: null,
        systemOff: false,
        isDeadPower: false, // Флаг: Энергия кончилась сама (0%)
        rebootInProgress: false,
        rebootApprovalNeeded: false,
        rebootStartTime: 0,
        phoneCallDone: false
    };

    for (let i = 0; i < game.settings.doorCount; i++) {
        game.doors.push({ id: i, closed: false, animating: false });
    }

    for (let i = 0; i < 8; i++) {
        game.cameras.push({ connected: false, broken: false, repairing: false, repairStart: 0, socketId: null });
    }

    games[gameId] = game;
    return game;
}

function getGameHour(game) {
    return Math.min(Math.floor((game.activePlayTimeMs || 0) / HOUR_DURATION_MS), 6);
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
    game.doors.forEach(d => { if (d.closed) drain += DOOR_POWER_DRAIN; });
    return drain;
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
        doors: game.doors.map(d => ({ id: d.id, closed: d.closed, animating: d.animating })),
        cameras: game.cameras.map((c, i) => ({ id: i, connected: c.connected, broken: c.broken, repairing: c.repairing })),
        animatronics: game.animatronics.map((a, i) => ({ id: i, connected: a.connected, name: a.name })),
        mode: game.settings.mode,
        doorCount: game.settings.doorCount,
        night: game.settings.night,
        systemOff: game.systemOff,
        isDeadPower: game.isDeadPower, 
        rebootInProgress: game.rebootInProgress,
        rebootApprovalNeeded: game.rebootApprovalNeeded,
        phoneCallDone: game.phoneCallDone
    };
}

// ===== ГЛАВНЫЙ ИГРОВОЙ ЦИКЛ =====
setInterval(() => {
    const now = Date.now();

    Object.values(games).forEach(game => {
        if (game.state !== 'playing') return;

        const last = game.lastTickTime || now;
        const delta = now - last;
        game.lastTickTime = now;

        // ВРЕМЯ ИДЕТ ВСЕГДА! (Чтобы 6 AM могло спасти от скримера в темноте)
        game.activePlayTimeMs += delta;

        // ПРОВЕРКА ПОБЕДЫ (6 AM)
        const newHour = getGameHour(game);
        if (newHour !== game.hour) {
            game.hour = newHour;
            if (game.hour >= 6) {
                game.state = 'won';
                io.to('game_' + game.id).emit('gameWon', getPublicState(game));
                return; // Победа!
            }
        }

        // РАСХОД ЭНЕРГИИ (если свет включен)
        if (!game.systemOff) {
            if (game.power > 0) {
                game.power -= getPowerDrain(game) * (delta / 1000);
                
                // ЕСЛИ ЭНЕРГИЯ КОНЧИЛАСЬ САМА (0%)
                if (game.power <= 0) {
                    game.power = 0;
                    game.powerAtOut = 0;
                    game.systemOff = true;
                    game.isDeadPower = true; // ЕСТЕСТВЕННЫЙ НОЛЬ
                    game.camerasUp = false;
                    game.doors.forEach(d => { d.closed = false; d.animating = false; });
                    game.powerOutTime = Date.now();
                    io.to('game_' + game.id).emit('powerOut', getPublicState(game));
                }
            }
        } else {
            // ЕСЛИ СВЕТ ВЫКЛЮЧЕН — ТАЙМЕР СМЕРТИ
            if (game.powerOutTime && !game.rebootInProgress && !game.rebootApprovalNeeded) {
                if (now - game.powerOutTime > POWER_OUT_DEATH_TIME) {
                    game.state = 'lost';
                    io.to('game_' + game.id).emit('gameLost', { ...getPublicState(game), reason: 'power_out' });
                    return;
                }
            }
        }

        io.to('game_' + game.id).emit('gameState', getPublicState(game));
    });
}, TICK_INTERVAL);

// ===== СОБЫТИЯ SOCKET.IO =====
io.on('connection', (socket) => {
    socket.on('createGame', (settings, callback) => {
        const game = createGame(settings);
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

        game.animatronics.push({ connected: false, socketId: null, name: 'Animatronic' });

        callback({ success: true, gameId: game.id, links, state: getPublicState(game) });
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
        if (!game) return callback({ success: false });
        if (camIndex < 0 || camIndex >= 8) return callback({ success: false });

        game.cameras[camIndex].connected = true;
        game.cameras[camIndex].socketId = socket.id;
        socket.join('game_' + gameId);
        socket.gameId = gameId;
        socket.role = 'camera';
        socket.camIndex = camIndex;

        io.to('game_' + gameId).emit('cameraConnected', { camIndex, state: getPublicState(game) });
        callback({ success: true, camIndex, isBroken: game.cameras[camIndex].broken, isRepairing: game.cameras[camIndex].repairing });
    });

    socket.on('joinAsAnimatronic', ({ gameId, name }, callback) => {
        const game = games[gameId];
        if (!game) return callback({ success: false });

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

        io.to('game_' + gameId).emit('animatronicConnected', { animIndex: idx, name, state: getPublicState(game) });
        callback({ success: true, animIndex: idx });
    });

    socket.on('startGame', (gameId) => {
        const game = games[gameId];
        if (!game) return;

        game.state = 'playing';
        game.activePlayTimeMs = 0;
        game.lastTickTime = Date.now();
        game.hour = 0;
        game.power = MAX_POWER;
        game.powerAtOut = MAX_POWER;
        game.systemOff = false;
        game.isDeadPower = false;
        game.camerasUp = false;
        game.currentCamera = 0;
        game.doors.forEach(d => { d.closed = false; d.animating = false; });
        game.cameras.forEach(c => { c.broken = false; c.repairing = false; });

        io.to('game_' + gameId).emit('gameStarted', getPublicState(game));
    });

    socket.on('toggleCameras', (gameId) => {
        const game = games[gameId];
        if (game && game.state === 'playing' && !game.systemOff) {
            game.camerasUp = !game.camerasUp;
            io.to('game_' + gameId).emit('camerasToggled', { camerasUp: game.camerasUp, state: getPublicState(game) });
        }
    });

    socket.on('switchCamera', ({ gameId, camIndex }) => {
        const game = games[gameId];
        if (game && game.state === 'playing' && !game.systemOff && game.camerasUp) {
            game.currentCamera = camIndex;
            io.to('game_' + gameId).emit('cameraSwitched', { currentCamera: camIndex, state: getPublicState(game) });
        }
    });

    socket.on('toggleDoor', ({ gameId, doorIndex }) => {
        const game = games[gameId];
        if (game && game.state === 'playing' && !game.systemOff) {
            const door = game.doors[doorIndex];
            if (door.animating) return;
            door.closed = !door.closed;
            door.animating = true;

            const animTime = door.closed ? DOOR_CLOSE_MS : DOOR_OPEN_MS;
            io.to('game_' + gameId).emit('doorToggled', { doorIndex, closed: door.closed, animTime, state: getPublicState(game) });

            setTimeout(() => {
                door.animating = false;
                io.to('game_' + gameId).emit('doorAnimDone', { doorIndex, state: getPublicState(game) });
            }, animTime);
        }
    });

    socket.on('cameraFrame', ({ gameId, camIndex, frameData }) => {
        const game = games[gameId];
        if (game && game.camerasUp && game.currentCamera === camIndex && game.guardSocket && !game.cameras[camIndex].broken) {
            io.to(game.guardSocket).emit('cameraFrame', { camIndex, frameData, broken: game.cameras[camIndex].broken });
        }
    });

    socket.on('breakCamera', ({ gameId, camIndex }) => {
        const game = games[gameId];
        if (game && game.state === 'playing') {
            game.cameras[camIndex].broken = true;
            game.cameras[camIndex].repairing = false;
            io.to('game_' + gameId).emit('cameraBrokenNotify', { camIndex, state: getPublicState(game) });
            io.to('game_' + gameId).emit('cameraBroken', { camIndex });
        }
    });

    socket.on('startRepairCamera', ({ gameId, camIndex }) => {
        const game = games[gameId];
        if (game && game.cameras[camIndex].broken && !game.cameras[camIndex].repairing) {
            game.cameras[camIndex].repairing = true;
            game.cameras[camIndex].repairStart = Date.now();
            io.to('game_' + gameId).emit('cameraRepairing', { camIndex, state: getPublicState(game) });

            setTimeout(() => {
                if (games[gameId]) {
                    game.cameras[camIndex].broken = false;
                    game.cameras[camIndex].repairing = false;
                    io.to('game_' + gameId).emit('cameraRepaired', { camIndex });
                    io.to('game_' + gameId).emit('cameraRepairedNotify', { camIndex, state: getPublicState(game) });
                }
            }, 20000);
        }
    });

    // АНИМАТРОНИК ОТКЛЮЧАЕТ СВЕТ
    socket.on('killPower', ({ gameId }) => {
        const game = games[gameId];
        if (game && game.state === 'playing' && !game.systemOff) {
            game.powerAtOut = game.power; 
            game.power = 0;
            game.systemOff = true;
            game.isDeadPower = false; // САБОТАЖ
            game.camerasUp = false;
            game.doors.forEach(d => { d.closed = false; d.animating = false; });
            game.powerOutTime = Date.now();
            io.to('game_' + gameId).emit('powerOut', getPublicState(game));
        }
    });

    socket.on('startReboot', (gameId) => {
        const game = games[gameId];
        if (!game || game.state !== 'playing' || !game.systemOff || game.rebootInProgress) return;
        if (game.isDeadPower) return; // Нельзя перезагрузить, если 0%

        game.rebootInProgress = true;
        game.rebootStartTime = Date.now();
        io.to('game_' + gameId).emit('rebootStarted', getPublicState(game));

        setTimeout(() => {
            if (game.state === 'playing') {
                game.rebootApprovalNeeded = true;
                io.to('game_' + gameId).emit('rebootWaitingApproval', getPublicState(game));
            }
        }, REBOOT_TIME);
    });

    socket.on('approveReboot', ({ gameId }) => {
        const game = games[gameId];
        if (game && game.state === 'playing') {
            game.systemOff = false;
            game.rebootInProgress = false;
            game.rebootApprovalNeeded = false;
            game.powerOutTime = null;
            // Возвращаем энергию со штрафом 5%
            game.power = Math.max(1, game.powerAtOut - 5);
            game.lastTickTime = Date.now(); // Сброс таймера, чтобы не скакнуло время
            io.to('game_' + gameId).emit('rebootApproved', getPublicState(game));
        }
    });

    socket.on('denyReboot', ({ gameId }) => {
        const game = games[gameId];
        if (game && game.state === 'playing') {
            game.rebootInProgress = false;
            game.rebootApprovalNeeded = false;
            io.to('game_' + gameId).emit('rebootDenied', getPublicState(game));
        }
    });

    socket.on('jumpscare', ({ gameId }) => {
        const game = games[gameId];
        if (game && game.state === 'playing') {
            game.state = 'lost';
            io.to('game_' + gameId).emit('gameLost', { ...getPublicState(game), reason: 'jumpscare' });
        }
    });

    socket.on('phoneCallDone', (gameId) => {
        const game = games[gameId];
        if (game) game.phoneCallDone = true;
    });

    socket.on('disconnect', () => {
        if (socket.gameId && games[socket.gameId]) {
            if (socket.role === 'camera' && typeof socket.camIndex === 'number') {
                games[socket.gameId].cameras[socket.camIndex].connected = false;
            }
            io.to('game_' + socket.gameId).emit('gameState', getPublicState(games[socket.gameId]));
        }
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`FNAF Server on port ${PORT}`);
});
