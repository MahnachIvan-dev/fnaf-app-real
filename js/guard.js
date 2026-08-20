Вот готовый, полностью рабочий файл **`public/js/guard.js`** со всеми указанными ссылками, исправленным синтаксисом и поддержкой мелодий старта/победы и звонков Телефонного парня:

```javascript
(function(){
const socket = io();
const params = new URLSearchParams(location.search);
const gameId = params.get('game');

if (!gameId) {
    document.body.innerHTML = '<div style="color:red;padding:40px;font-size:1.5rem;font-family:monospace;">No game ID.</div>';
    return;
}

let S = null;
let mode = 1;
let camsUp = false;
let curCam = 0;
let rebooting = false;
let rebootT0 = 0;

// ===== ФУНКЦИЯ СОЗДАНИЯ АУДИО =====
function au(src, loop, vol) {
    const a = new Audio(src);
    a.loop = !!loop;
    a.volume = vol !== undefined ? vol : 0.4;
    return a;
}

// 📞 ССЫЛКИ НА ЗВОНКИ ТЕЛЕФОННОГО ПАРНЯ (5 НОЧЕЙ)
const PHONE_CALL_URLS = {
    1: 'https://files.catbox.moe/9hb3et.ogg', // Ночь 1
    2: 'https://files.catbox.moe/8kk4je.ogg', // Ночь 2
    3: 'https://files.catbox.moe/8kk4je.ogg', // Ночь 3
    4: 'https://files.catbox.moe/8kk4je.ogg', // Ночь 4
    5: 'https://files.catbox.moe/8kk4je.ogg', // Ночь 5
};

// 🔊 ОБЪЕКТ СО ВСЕМИ ЗВУКАМИ ОХРАННИКА
const snd = {
    nightStart: au('https://files.catbox.moe/x39e6b.ogg', false, 0.6), // Мелодия старта ночи
    winMelody:  au('https://files.catbox.moe/esjta4.ogg', false, 0.6),                // Мелодия после 6 AM

    amb:      au('https://files.catbox.moe/ad5yrw.mp3', true, 0.2),
    camUp:    au('https://files.catbox.moe/d8qyqe.mp3', false, 0.5),
    camDown:  au('https://files.catbox.moe/hljkyi.mp3', false, 0.5),
    camSw:    au('https://files.catbox.moe/4a9er6.mp3', false, 0.4),
    dClose:   au('https://files.catbox.moe/xrln60.mp3', false, 0.6),
    dOpen:    au('https://files.catbox.moe/i0tyqu.mp3', false, 0.5),
    pwrOut:   au('https://files.catbox.moe/hvxd67.mp3', false, 0.7),
    pwrOn:    au('https://files.catbox.moe/zuy3mk.mp3', false, 0.7),
scare:    au('https://files.catbox.moe/bfucts.mp3', false, 1.0),
    win:      au('https://files.catbox.moe/13m0my.mp3', false, 0.8),
    noise:    au('https://files.catbox.moe/wn4b5f.mp3', true, 0.08),
    phone:    null
};

function play(a) { try { a.currentTime = 0; a.play(); } catch(e) {} }
function stop(a) { try { a.pause(); a.currentTime = 0; } catch(e) {} }

const canvas = document.getElementById('camCanvas');
const ctx = canvas.getContext('2d');
const frameImg = new Image();

socket.emit('joinAsGuard', gameId, res => {
    if (!res.success) {
        document.body.innerHTML = '<div style="color:red;padding:40px;font-size:1.5rem;">Game not found</div>';
        return;
    }
    S = res.state;
    mode = S.mode;
    init();
});

function init() {
    if (mode === 2) {
        document.getElementById('office').style.display = 'block';
        const cc = document.getElementById('camCont');
        cc.classList.add('mode2-down');
        document.getElementById('officeMonBtn').addEventListener('click', toggleCams);
        document.getElementById('officeMonBtn').addEventListener('touchend', e => { e.preventDefault(); toggleCams(); });
    } else {
        document.getElementById('camCont').classList.add('mode1-hidden');
    }
    buildDoors();
    buildCamBtns();
    buildTouchBar();
    updateUI();
}

const DOOR_NAMES = ['LEFT','RIGHT','BACK'];
const DOOR_KEYS = ['Q','W','E'];
const DOOR_POS = n => n===1 ? ['left'] : n===2 ? ['left','right'] : ['left','right','center'];

function buildDoors() {
    const pos = DOOR_POS(S.doorCount);
    let pH = '', bH = '';
    pos.forEach((p, i) => {
        pH += `<div class="door-panel ${p}" id="dPanel${i}"><div class="stripe"></div></div>`;
        const pc = p === 'center' ? 'pos-center' : 'pos-' + p;
        bH += `<div class="door-btns-wrap ${pc}">
            <div class="door-toggle open" id="dBtn${i}" data-door="${i}">
                <span class="d-icon">🚪</span>
                <span class="d-name">${DOOR_NAMES[i]||'DOOR '+(i+1)}</span>
                <span class="d-key">[${DOOR_KEYS[i]}]</span>
            </div>
        </div>`;
    });
    document.getElementById('doorPanels').innerHTML = pH;
    document.getElementById('doorBtns').innerHTML = bH;
    pos.forEach((_, i) => {
        const el = document.getElementById('dBtn' + i);
        el.addEventListener('click', () => doDoor(i));
        el.addEventListener('touchend', e => { e.preventDefault(); doDoor(i); });
    });
}

function doDoor(i) { socket.emit('toggleDoor', { gameId, doorIndex: i }); }

function buildCamBtns() {
    const box = document.getElementById('camBtns');
    let h = '';
    if (S.cameras) {
        S.cameras.forEach((c, i) => {
            const cls = c.connected ? (c.broken ? 'broken' : '') : 'off';
            h += `<div class="cam-btn-item ${cls} ${i===curCam&&camsUp?'active':''}" id="cBtn${i}">CAM ${i+1}</div>`;
        });
    }
    box.innerHTML = h;
    S.cameras.forEach((c, i) => {
        const el = document.getElementById('cBtn' + i);
        if (!el) return;
        const fn = () => { if (camsUp && c.connected) switchCam(i); };
        el.addEventListener('click', fn);
        el.addEventListener('touchend', e => { e.preventDefault(); fn(); });
    });
}

function buildTouchBar() {
    const bar = document.getElementById('touchBar');
    let h = `<div class="touch-btn" id="tCam">📷 CAM</div>`;
    DOOR_POS(S.doorCount).forEach((_, i) => {
        h += `<div class="touch-btn" id="tDoor${i}">🚪 ${DOOR_NAMES[i]||'D'+(i+1)}</div>`;
    });
    h += `<div class="touch-btn" id="tReboot" style="display:none">🔄 REBOOT</div>`;
    bar.innerHTML = h;

    const camBtn = document.getElementById('tCam');
    camBtn.addEventListener('click', toggleCams);
    camBtn.addEventListener('touchend', e => { e.preventDefault(); toggleCams(); });
    DOOR_POS(S.doorCount).forEach((_, i) => {
        const el = document.getElementById('tDoor' + i);
        el.addEventListener('click', () => doDoor(i));
        el.addEventListener('touchend', e => { e.preventDefault(); doDoor(i); });
    });
    const rb = document.getElementById('tReboot');
    rb.addEventListener('click', doReboot);
    rb.addEventListener('touchend', e => { e.preventDefault(); doReboot(); });
}

function toggleCams() { socket.emit('toggleCameras', gameId); }
function switchCam(i) { socket.emit('switchCamera', { gameId, camIndex: i }); }

function doReboot() {
    if (!S || !S.systemOff || rebooting) return;
    rebooting = true;
    rebootT0 = Date.now();
    socket.emit('startReboot', gameId);
}

document.addEventListener('keydown', e => {
    if (!S || S.state !== 'playing') return;
    const k = e.code;
    if (k === 'Space') { e.preventDefault(); toggleCams(); }
    else if (k === 'Digit1' || k === 'Numpad1') switchCam(0);
    else if (k === 'Digit2' || k === 'Numpad2') switchCam(1);
    else if (k === 'Digit3' || k === 'Numpad3') switchCam(2);
    else if (k === 'Digit4' || k === 'Numpad4') switchCam(3);
    else if (k === 'Digit5' || k === 'Numpad5') switchCam(4);
    else if (k === 'Digit6' || k === 'Numpad6') switchCam(5);
    else if (k === 'Digit7' || k === 'Numpad7') switchCam(6);
    else if (k === 'Digit8' || k === 'Numpad8') switchCam(7);
    else if (k === 'KeyQ') doDoor(0);
    else if (k === 'KeyW' && S.doorCount >= 2) doDoor(1);
    else if (k === 'KeyE' && S.doorCount >= 3) doDoor(2);
    else if (k === 'KeyH') doReboot();
});

// ===== СОБЫТИЯ СЕРВЕРА =====

// СТАРТ ИГРЫ
socket.on('gameStarted', st => {
    S = st; mode = st.mode;
    updateUI();
    
    // 1. Проигрываем стартовую мелодию
    play(snd.nightStart);
    
    // 2. После окончания мелодии старта включаем фоновый гул и запускаем звонок Телефонного парня
    snd.nightStart.onended = () => {
        try { snd.amb.play(); } catch(e) {}
        playPhone(st.night);
    };
});

socket.on('gameState', st => { S = st; updateUI(); });

socket.on('camerasToggled', d => {
    S = d.state;
    camsUp = d.camerasUp;
    updateCamView();
    if (camsUp) {
        play(snd.camUp);
    } else {
        play(snd.camDown);
    }
});

socket.on('cameraSwitched', d => {
    S = d.state;
    curCam = d.currentCamera;
    updateCamView();
    play(snd.camSw);
});

socket.on('doorToggled', d => {
    S = d.state;
    const panel = document.getElementById('dPanel' + d.doorIndex);
    const btn = document.getElementById('dBtn' + d.doorIndex);
    const tBtn = document.getElementById('tDoor' + d.doorIndex);

    if (panel) {
        panel.classList.remove('anim-close','anim-open');
        void panel.offsetWidth;
        if (d.closed) {
            panel.classList.add('anim-close','shut');
            play(snd.dClose);
        } else {
            panel.classList.remove('shut');
            panel.classList.add('anim-open');
            play(snd.dOpen);
        }
    }
    if (btn) btn.className = 'door-toggle ' + (d.closed ? 'closed' : 'open') + ' busy';
    if (tBtn) tBtn.classList.toggle('door-closed', d.closed);
});

socket.on('doorAnimDone', d => {
    S = d.state;
    d.state.doors.forEach((dr, i) => {
        const btn = document.getElementById('dBtn' + i);
        if (btn) btn.className = 'door-toggle ' + (dr.closed ? 'closed' : 'open');
    });
});

socket.on('cameraFrame', d => {
    if (!camsUp || curCam !== d.camIndex) return;
    if (d.broken) { showBroken(); return; }
    document.getElementById('noSig').style.display = 'none';
    frameImg.onload = () => {
        canvas.width = frameImg.width;
        canvas.height = frameImg.height;
        ctx.drawImage(frameImg, 0, 0);
    };
    frameImg.src = d.frameData;
});

socket.on('cameraBrokenNotify', d => {
    S = d.state;
    buildCamBtns();
    if (camsUp && curCam === d.camIndex) showBroken();
});

socket.on('cameraRepairedNotify', d => {
    S = d.state;
    buildCamBtns();
    if (camsUp && curCam === d.camIndex) {
        document.getElementById('noSig').style.display = 'none';
    }
});

socket.on('cameraRepairing', d => { S = d.state; });

socket.on('powerOut', st => {
    S = st;
    camsUp = false;
    updateCamView();
    document.getElementById('pwrOut').classList.add('on');
    stop(snd.amb);
    stop(snd.noise);
    stop(snd.nightStart);
    if (snd.phone) snd.phone.pause();
    play(snd.pwrOut);
    setTimeout(() => {
        document.getElementById('rebootHint').style.display = 'block';
        const tb = document.getElementById('tReboot');
        if (tb) tb.style.display = 'block';
    }, 3000);
});

socket.on('rebootStarted', st => {
    S = st;
    document.getElementById('rebootHint').style.display = 'none';
    document.getElementById('rebootBar').style.display = 'block';
    document.getElementById('rebootMsg').textContent = 'REBOOTING SYSTEMS...';
    animReboot();
});

socket.on('rebootWaitingApproval', st => {
    S = st;
    document.getElementById('rebootFill').style.width = '100%';
    document.getElementById('rebootMsg').textContent = 'WAITING FOR APPROVAL...';
});

socket.on('rebootApproved', st => {
    S = st;
    rebooting = false;
    document.getElementById('pwrOut').classList.remove('on');
    document.getElementById('rebootBar').style.display = 'none';
    document.getElementById('rebootMsg').textContent = '';
    const tb = document.getElementById('tReboot');
    if (tb) tb.style.display = 'none';
    doFlash();
    play(snd.pwrOn);
    try { snd.amb.play(); } catch(e) {}
    updateUI();
});

socket.on('rebootDenied', st => {
    S = st;
    rebooting = false;
    document.getElementById('rebootBar').style.display = 'none';
    document.getElementById('rebootMsg').textContent = 'REBOOT DENIED. Try again.';
    document.getElementById('rebootHint').style.display = 'block';
});

socket.on('gameLost', d => {
    S = d;
    stop(snd.amb);
    stop(snd.noise);
    stop(snd.nightStart);
    if (snd.phone) snd.phone.pause();
    play(snd.scare);
    document.getElementById('scareScr').classList.add('on');
});

// ПОБЕДА (6:00 AM)
socket.on('gameWon', st => {
    S = st;
    stop(snd.amb);
    stop(snd.noise);
    stop(snd.nightStart);
    if (snd.phone) snd.phone.pause();
    
    // Проигрываем звон часов и крики 6 AM
    play(snd.win);
    document.getElementById('winScr').classList.add('on');
    spawnConf();

    // Как только звук победы доиграет — запускаем триумфальную музыку
    snd.win.onended = () => {
        play(snd.winMelody);
    };
});

// ===== ОБНОВЛЕНИЕ ИНТЕРФЕЙСА =====

function updateUI() {
    if (!S) return;
    document.getElementById('hTime').textContent = S.hourString;
    const p = Math.round(S.power);
    const pe = document.getElementById('hPwr');
    pe.textContent = p + '%';
    pe.className = 'pwr-val ' + (p <= 15 ? 'lo' : p <= 40 ? 'md' : 'hi');
    let bars = 1;
    if (S.camerasUp) bars++;
    S.doors.forEach(d => { if (d.closed) bars++; });
    document.getElementById('hUsage').textContent = 'Usage: ' + '█'.repeat(bars);
    S.doors.forEach((d, i) => {
        const panel = document.getElementById('dPanel' + i);
        const btn = document.getElementById('dBtn' + i);
        if (panel) panel.classList.toggle('shut', d.closed);
        if (btn && !d.animating) btn.className = 'door-toggle ' + (d.closed ? 'closed' : 'open');
    });
    camsUp = S.camerasUp;
    curCam = S.currentCamera;
    updateCamView();
    if (S.systemOff) document.getElementById('pwrOut').classList.add('on');
}

function updateCamView() {
    const cc = document.getElementById('camCont');
    if (mode === 1) {
        cc.classList.toggle('mode1-hidden', !camsUp);
    } else {
        cc.classList.toggle('mode2-up', camsUp);
        cc.classList.toggle('mode2-down', !camsUp);
    }
    const tCam = document.getElementById('tCam');
    if (tCam) tCam.classList.toggle('on', camsUp);
    document.getElementById('camLbl').textContent = 'CAM ' + (curCam + 1);
    if (S && S.cameras) {
        S.cameras.forEach((c, i) => {
            const el = document.getElementById('cBtn' + i);
            if (!el) return;
            el.classList.toggle('active', i === curCam && camsUp);
            el.classList.toggle('broken', c.broken);
            el.classList.toggle('off', !c.connected);
        });
    }
    if (camsUp && S && S.cameras[curCam]) {
        const c = S.cameras[curCam];
        if (c.broken) {
            showBroken();
        } else if (!c.connected) {
            const ns = document.getElementById('noSig');
            ns.style.display = 'block';
            ns.textContent = 'NO SIGNAL';
        } else {
            document.getElementById('noSig').style.display = 'none';
        }
    }
    if (camsUp) { try { snd.noise.play(); } catch(e) {} }
    else { try { snd.noise.pause(); } catch(e) {} }
}

function showBroken() {
    const ns = document.getElementById('noSig');
    ns.style.display = 'block';
    ns.innerHTML = 'CAMERA MALFUNCTION<br><span style="color:var(--yellow);font-size:.7em;">Repair from camera device</span>';
    drawNoise();
}

function drawNoise() {
    canvas.width = 320; canvas.height = 240;
    const d = ctx.createImageData(320, 240);
    for (let i = 0; i < d.data.length; i += 4) {
        const v = Math.random() * 255;
        d.data[i] = v; d.data[i+1] = v; d.data[i+2] = v; d.data[i+3] = 255;
    }
    ctx.putImageData(d, 0, 0);
}

function animReboot() {
    if (!rebooting) return;
    const p = Math.min((Date.now() - rebootT0) / 15000, 1);
    document.getElementById('rebootFill').style.width = (p * 100) + '%';
    if (p < 1) requestAnimationFrame(animReboot);
}

function doFlash() {
    const f = document.getElementById('flash');
    f.classList.add('pop');
    setTimeout(() => f.classList.remove('pop'), 120);
}

// ===== ВОСПРОИЗВЕДЕНИЕ ЗВОНКА ТЕЛЕФОННОГО ПАРНЯ =====
function playPhone(night) {
    const callUrl = PHONE_CALL_URLS[night];
    if (!callUrl) return;

    const muteBtn = document.getElementById('muteCallBtn');
    if (muteBtn) muteBtn.style.display = 'block';

    snd.phone = new Audio(callUrl);
    snd.phone.volume = 0.7;

    setTimeout(() => {
        if (!S || S.state !== 'playing' || S.systemOff) return;
        snd.phone.play().catch(() => {});
    }, 1000);

    snd.phone.onended = () => {
        if (muteBtn) muteBtn.style.display = 'none';
        socket.emit('phoneCallDone', gameId);
    };
}

window.mutePhoneCall = function() {
    if (snd.phone) {
        snd.phone.pause();
        snd.phone.currentTime = 0;
    }
    const muteBtn = document.getElementById('muteCallBtn');
    if (muteBtn) muteBtn.style.display = 'none';
    socket.emit('phoneCallDone', gameId);
};

function spawnConf() {
    const box = document.getElementById('confBox');
    const cols = ['#ff0040','#00ff41','#ffaa00','#0088ff','#ff00ff','#00ffff','#fff'];
    for (let i = 0; i < 80; i++) {
        const c = document.createElement('div');
        c.className = 'confetti-piece';
        c.style.left = Math.random() * 100 + '%';
        c.style.background = cols[Math.floor(Math.random() * cols.length)];
        c.style.animationDuration = (2 + Math.random() * 3) + 's';
        c.style.animationDelay = Math.random() * 2 + 's';
        c.style.width = (5 + Math.random() * 8) + 'px';
        c.style.height = (5 + Math.random() * 8) + 'px';
        box.appendChild(c);
    }
}

})();
```
