(function(){
const socket = io();
const params = new URLSearchParams(location.search);
const gameId = params.get('game');

if (!gameId) {
    document.body.innerHTML = '<div style="color:red;padding:40px;font-size:1.5rem;font-family:monospace;">No game ID. Create a game first at /</div>';
    return;
}

let S = null; // game state
let mode = 1;
let camsUp = false;
let curCam = 0;
let rebooting = false;
let rebootT0 = 0;

// Audio
function au(src, loop) { const a = new Audio(src); a.loop = !!loop; a.volume = .4; return a; }
const snd = {
    amb: au('/audio/ambience.mp3', true),
    camUp: au('/audio/camera_up.mp3'),
    camSw: au('/audio/camera_switch.mp3'),
    dClose: au('/audio/door_close.mp3'),
    dOpen: au('/audio/door_open.mp3'),
    pwrOut: au('/audio/power_out.mp3'),
    scare: au('/audio/jumpscare.mp3'),
    win: au('/audio/win.mp3'),
    noise: au('/audio/static.mp3', true),
    phone: null
};
function play(a){ try{ a.currentTime=0; a.play(); }catch(e){} }
function stop(a){ try{ a.pause(); a.currentTime=0; }catch(e){} }

const canvas = document.getElementById('camCanvas');
const ctx = canvas.getContext('2d');
const frameImg = new Image();

// Join
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
    // Mode setup
    if (mode === 2) {
        document.getElementById('office').style.display = 'block';
        const cc = document.getElementById('camCont');
        cc.classList.add('mode2-down');
        document.getElementById('officeMonBtn').addEventListener('click', () => toggleCams());
        document.getElementById('officeMonBtn').addEventListener('touchend', e => { e.preventDefault(); toggleCams(); });
    } else {
        document.getElementById('camCont').classList.add('mode1-hidden');
    }

    buildDoors();
    buildCamBtns();
    buildTouchBar();
    updateUI();
}

/* ===== DOORS ===== */
const DOOR_NAMES = ['LEFT','RIGHT','BACK'];
const DOOR_KEYS = ['Q','W','E'];
const DOOR_POS = (n) => n===1 ? ['left'] : n===2 ? ['left','right'] : ['left','right','center'];

function buildDoors() {
    const positions = DOOR_POS(S.doorCount);
    let panelsH = '', btnsH = '';

    positions.forEach((pos, i) => {
        panelsH += `<div class="door-panel ${pos}" id="dPanel${i}"><div class="stripe"></div></div>`;
        const posClass = pos === 'center' ? 'pos-center' : 'pos-' + pos;
        btnsH += `<div class="door-btns-wrap ${posClass}">
            <div class="door-toggle open" id="dBtn${i}" data-door="${i}">
                <span class="d-icon">🚪</span>
                <span class="d-name">${DOOR_NAMES[i]||'DOOR '+(i+1)}</span>
                <span class="d-key">[${DOOR_KEYS[i]}]</span>
            </div>
        </div>`;
    });

    document.getElementById('doorPanels').innerHTML = panelsH;
    document.getElementById('doorBtns').innerHTML = btnsH;

    // Click/touch handlers for door buttons
    positions.forEach((_, i) => {
        const el = document.getElementById('dBtn' + i);
        el.addEventListener('click', () => doDoor(i));
        el.addEventListener('touchend', e => { e.preventDefault(); doDoor(i); });
    });
}

function doDoor(i) { socket.emit('toggleDoor', { gameId, doorIndex: i }); }

/* ===== CAMERA BUTTONS ===== */
function buildCamBtns() {
    const box = document.getElementById('camBtns');
    let h = '';
    if (S.cameras) {
        S.cameras.forEach((c, i) => {
            const cls = c.connected ? (c.broken ? 'broken' : '') : 'off';
            h += `<div class="cam-btn-item ${cls} ${i===curCam && camsUp ? 'active':''}" id="cBtn${i}" data-cam="${i}">CAM ${i+1}</div>`;
        });
    }
    box.innerHTML = h;

    // Handlers
    S.cameras.forEach((c, i) => {
        const el = document.getElementById('cBtn' + i);
        if (!el) return;
        const handler = () => { if (camsUp && c.connected) switchCam(i); };
        el.addEventListener('click', handler);
        el.addEventListener('touchend', e => { e.preventDefault(); handler(); });
    });
}

/* ===== TOUCH BAR ===== */
function buildTouchBar() {
    const bar = document.getElementById('touchBar');
    let h = `<div class="touch-btn" id="tCam">📷 CAM</div>`;

    const positions = DOOR_POS(S.doorCount);
    positions.forEach((_, i) => {
        h += `<div class="touch-btn" id="tDoor${i}" data-door="${i}">🚪 ${DOOR_NAMES[i]||'D'+(i+1)}</div>`;
    });

    h += `<div class="touch-btn" id="tReboot" style="display:none">🔄 REBOOT</div>`;
    bar.innerHTML = h;

    // Handlers
    const camBtn = document.getElementById('tCam');
    camBtn.addEventListener('click', toggleCams);
    camBtn.addEventListener('touchend', e => { e.preventDefault(); toggleCams(); });

    positions.forEach((_, i) => {
        const el = document.getElementById('tDoor' + i);
        el.addEventListener('click', () => doDoor(i));
        el.addEventListener('touchend', e => { e.preventDefault(); doDoor(i); });
    });

    const rb = document.getElementById('tReboot');
    rb.addEventListener('click', doReboot);
    rb.addEventListener('touchend', e => { e.preventDefault(); doReboot(); });
}

/* ===== CAMERA TOGGLE ===== */
function toggleCams() { socket.emit('toggleCameras', gameId); }
function switchCam(i) { socket.emit('switchCamera', { gameId, camIndex: i }); }

/* ===== REBOOT ===== */
function doReboot() {
    if (!S || !S.systemOff || rebooting) return;
    rebooting = true;
    rebootT0 = Date.now();
    socket.emit('startReboot', gameId);
}

/* ===== KEYBOARD ===== */
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

/* ===== SOCKET EVENTS ===== */

socket.on('gameStarted', st => {
    S = st; mode = st.mode;
    updateUI();
    try { snd.amb.play(); } catch(e){}
    playPhone(st.night);
});

socket.on('gameState', st => { S = st; updateUI(); });

socket.on('camerasToggled', d => {
    S = d.state;
    camsUp = d.camerasUp;
    updateCamView();
    play(snd.camUp);
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
        void panel.offsetWidth; // force reflow
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
    try { snd.amb.play(); } catch(e){}
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
    stop(snd.amb); stop(snd.noise);
    play(snd.scare);
    document.getElementById('scareScr').classList.add('on');
});

socket.on('gameWon', st => {
    S = st;
    stop(snd.amb); stop(snd.noise);
    play(snd.win);
    document.getElementById('winScr').classList.add('on');
    spawnConf();
});

/* ===== UI ===== */

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

    // Doors
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

    // Update cam buttons
    if (S && S.cameras) {
        S.cameras.forEach((c, i) => {
            const el = document.getElementById('cBtn' + i);
            if (!el) return;
            el.classList.toggle('active', i === curCam && camsUp);
            el.classList.toggle('broken', c.broken);
            el.classList.toggle('off', !c.connected);
        });
    }

    // Show broken / no signal
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

    // Static sound
    if (camsUp) { try { snd.noise.volume = .08; snd.noise.play(); } catch(e){} }
    else { try { snd.noise.pause(); } catch(e){} }
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

function playPhone(night) {
    snd.phone = new Audio('/audio/phone_call_night' + night + '.mp3');
    snd.phone.volume = .6;
    snd.phone.play().catch(()=>{});
    snd.phone.onended = () => socket.emit('phoneCallDone', gameId);
}

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