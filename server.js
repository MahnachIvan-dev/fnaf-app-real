const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" }, pingTimeout: 60000, pingInterval: 25000 });

app.use(express.static(path.join(__dirname, 'public')));

const games = {};

const HOUR_DURATION_MS = 4 * 60 * 1000; // 1 час = 4 минуты
const MAX_POWER = 100;
const TICK_INTERVAL = 500;

const BASE_POWER_DRAIN = 0.025;   
const CAMERA_POWER_DRAIN = 0.020; 
const DOOR_POWER_DRAIN = 0.057;   

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
            night: Math.min(7, Math.max(1, settings.night || 1)),
            doorOverload: settings.doorOverload !== undefined ? settings.doorOverload : true
        },
        state: 'lobby',
        power: MAX_POWER,
        powerAtOut: MAX_POWER,
        hour: 0,
        activePlayTimeMs: 0,
        lastTickTime: null,
        camerasUp: false,
        currentCamera: 0,
        doors: [],
        cameras: Array.from({length: 8}, () => ({ connected: false, broken: false, repairing: false, repairStart: 0, socketId: null })),
        animatronics: [],
        guardSocket: null,
        powerOutTime: null,
        systemOff: false,
        isDeadPower: false, 
        rebootInProgress: false,
        rebootApprovalNeeded: false,
        
        // НОВЫЕ МЕХАНИКИ
        killPowerUsesLeft: 2, // Аниматроник может вырубить свет только 2 раза
        overloadLevel: 0,     // 0 - 100%
        overloadTripped: false
    };

    for (let i = 0; i < game.settings.doorCount; i++) {
        game.doors.push({ id: i, closed: false, animating: false });
    }
    games[gameId] = game;
    return game;
}

function getGameHour(game) { return Math.min(Math.floor((game.activePlayTimeMs || 0) / HOUR_DURATION_MS), 6); }
function getTimeString(hour) { return hour === 0 ? '12 AM' : (hour >= 6 ? '6 AM' : hour + ' AM'); }

function getPublicState(game) {
    return {
        id: game.id,
        state: game.state,
        power: Math.max(0, Math.round(game.power * 10) / 10),
        hour: game.hour,
        hourString: getTimeString(game.hour),
        camerasUp: game.camerasUp,
        currentCamera: game.currentCamera,
        doors: game.doors,
        cameras: game.cameras.map((c, i) => ({ id: i, connected: c.connected, broken: c.broken, repairing: c.repairing })),
        animatronics: game.animatronics,
        mode: game.settings.mode,
        doorCount: game.settings.doorCount,
        systemOff: game.systemOff,
        isDeadPower: game.isDeadPower,
        rebootInProgress: game.rebootInProgress,
        rebootApprovalNeeded: game.rebootApprovalNeeded,
        killPowerUsesLeft: game.killPowerUsesLeft,
        overloadLevel: Math.round(game.overloadLevel),
        overloadTripped: game.overloadTripped,
        doorOverloadEnabled: game.settings.doorOverload
    };
}

setInterval(() => {
    const now = Date.now();
    Object.values(games).forEach(game => {
        if (game.state !== 'playing') return;

        const delta = now - (game.lastTickTime || now);
        game.lastTickTime = now;
        game.activePlayTimeMs += delta;

        // Победа 6 AM
        if (getGameHour(game) !== game.hour) {
            game.hour = getGameHour(game);
            if (game.hour >= 6) {
                game.state = 'won';
                io.to('game_' + game.id).emit('gameWon', getPublicState(game));
                return;
            }
        }

        if (!game.systemOff) {
            if (game.power > 0) {
                let drain = BASE_POWER_DRAIN;
                let closedDoors = 0;
                
                if (game.camerasUp) drain += CAMERA_POWER_DRAIN;
                game.doors.forEach(d => { if (d.closed) { drain += DOOR_POWER_DRAIN; closedDoors++; } });
                
                game.power -= drain * (delta / 1000);
                
                if (game.power <= 0) {
                    game.power = 0; game.systemOff = true; game.isDeadPower = true;
                    game.camerasUp = false;
                    game.doors.forEach(d => { d.closed = false; d.animating = false; });
                    game.powerOutTime = Date.now();
                    io.to('game_' + game.id).emit('powerOut', getPublicState(game));
                }

                // ПЕРЕГРЕВ ДВЕРЕЙ (Анти-кемпер)
                if (game.settings.doorOverload && !game.overloadTripped) {
                    if (closedDoors >= 2) {
                        game.overloadLevel += (delta / 15000) * 100; // 15 сек до перегрева
                        if (game.overloadLevel >= 100) {
                            game.overloadLevel = 100;
                            game.overloadTripped = true;
                            game.power = Math.max(1, game.power - 3); // Штраф -3%
                            game.doors.forEach(d => { d.closed = false; });
                            io.to('game_' + game.id).emit('overloadTripped', getPublicState(game));
                        }
                    } else {
                        game.overloadLevel = Math.max(0, game.overloadLevel - (delta / 5000) * 100); // Остывает 5 сек
                    }
                }
            }
        } else {
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

io.on('connection', (socket) => {
    socket.on('createGame', (settings, cb) => {
        const game = createGame(settings);
        socket.join('game_' + game.id);
        const links = { guard: `/guard.html?game=${game.id}`, animatronic: `/animatronic.html?game=${game.id}`, cameras: Array.from({length:8}, (_,i)=>`/camera.html?game=${game.id}&cam=${i}`) };
        cb({ success: true, gameId: game.id, links, state: getPublicState(game) });
    });

    socket.on('joinAsGuard', (gameId, cb) => {
        const game = games[gameId];
        if (!game) return cb({ success: false });
        game.guardSocket = socket.id;
        socket.join('game_' + gameId);
        cb({ success: true, state: getPublicState(game) });
    });

    socket.on('joinAsCamera', ({ gameId, camIndex }, cb) => {
        const game = games[gameId];
        if (!game || !game.cameras[camIndex]) return cb({ success: false });
        game.cameras[camIndex].connected = true;
        game.cameras[camIndex].socketId = socket.id;
        socket.join('game_' + gameId);
        io.to('game_' + gameId).emit('cameraConnected', { camIndex, state: getPublicState(game) });
        cb({ success: true, camIndex, isBroken: game.cameras[camIndex].broken });
    });

    socket.on('joinAsAnimatronic', ({ gameId, name }, cb) => {
        const game = games[gameId];
        if (!game) return cb({ success: false });
        let idx = game.animatronics.findIndex(a => !a.connected);
        if (idx === -1) { idx = game.animatronics.length; game.animatronics.push({ connected: true, socketId: socket.id, name }); }
        else { game.animatronics[idx].connected = true; game.animatronics[idx].socketId = socket.id; }
        socket.join('game_' + gameId);
        cb({ success: true, animIndex: idx });
    });

    socket.on('startGame', (gameId) => {
        const game = games[gameId];
        if (!game) return;
        game.state = 'playing'; game.activePlayTimeMs = 0; game.lastTickTime = Date.now(); game.hour = 0;
        game.power = MAX_POWER; game.systemOff = false; game.isDeadPower = false; game.camerasUp = false;
        game.killPowerUsesLeft = 2; game.overloadLevel = 0; game.overloadTripped = false;
        game.doors.forEach(d => d.closed = false); game.cameras.forEach(c => { c.broken = false; c.repairing = false; });
        io.to('game_' + gameId).emit('gameStarted', getPublicState(game));
    });

    socket.on('toggleCameras', (gameId) => {
        const game = games[gameId];
        if (game && game.state === 'playing' && !game.systemOff && !game.overloadTripped) {
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
        if (game && game.state === 'playing' && !game.systemOff && !game.overloadTripped) {
            const door = game.doors[doorIndex];
            if (door.animating) return;
            door.closed = !door.closed;
            door.animating = true;
            io.to('game_' + gameId).emit('doorToggled', { doorIndex, closed: door.closed, state: getPublicState(game) });
            setTimeout(() => {
                door.animating = false;
                io.to('game_' + gameId).emit('doorAnimDone', { doorIndex, state: getPublicState(game) });
            }, door.closed ? DOOR_CLOSE_MS : DOOR_OPEN_MS);
        }
    });

    socket.on('resetBreaker', (gameId) => {
        const game = games[gameId];
        if (game && game.overloadTripped) {
            game.overloadTripped = false;
            game.overloadLevel = 0;
            io.to('game_' + gameId).emit('breakerReset', getPublicState(game));
        }
    });

    socket.on('playAudioProvocation', ({ gameId, soundType }) => {
        io.to('game_' + gameId).emit('playCameraSound', soundType);
    });

    socket.on('cameraFrame', ({ gameId, camIndex, frameData }) => {
        const game = games[gameId];
        if (game && game.camerasUp && game.currentCamera === camIndex && game.guardSocket && !game.cameras[camIndex].broken) {
            io.to(game.guardSocket).emit('cameraFrame', { camIndex, frameData, broken: false });
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
        if (game && game.cameras[camIndex].broken) {
            game.cameras[camIndex].repairing = true;
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

    socket.on('killPower', ({ gameId }) => {
        const game = games[gameId];
        if (game && game.state === 'playing' && !game.systemOff && game.killPowerUsesLeft > 0) {
            game.killPowerUsesLeft--;
            game.powerAtOut = game.power; 
            game.systemOff = true;
            game.isDeadPower = false; 
            game.camerasUp = false;
            game.doors.forEach(d => { d.closed = false; d.animating = false; });
            game.powerOutTime = Date.now();
            io.to('game_' + gameId).emit('powerOut', getPublicState(game));
        }
    });

    socket.on('startReboot', (gameId) => {
        const game = games[gameId];
        if (!game || game.state !== 'playing' || !game.systemOff || game.rebootInProgress || game.isDeadPower) return;
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
            game.power = Math.max(1, game.powerAtOut - 5);
            game.lastTickTime = Date.now(); 
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
});

server.listen(process.env.PORT || 8080, '0.0.0.0');
