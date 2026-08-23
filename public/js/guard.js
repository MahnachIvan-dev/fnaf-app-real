(function(){
const socket = io();
const params = new URLSearchParams(location.search);
const gameId = params.get('game');

if (!gameId) { document.body.innerHTML = '<div style="color:red;padding:40px;font-size:1.5rem;font-family:monospace;">No game ID.</div>'; return; }

let S = null; let mode = 1; let camsUp = false; let curCam = 0; let rebooting = false; let rebootT0 = 0;

function au(src, loop, vol) {
    const a = new Audio(); a.loop = !!loop; a.volume = vol !== undefined ? vol : 0.4;
    a.onerror = () => { console.warn('Audio failed:', src); }; a.src = src; return a;
}

const PHONE_CALL_URLS = {
    1: 'https://files.catbox.moe/9hb3et.ogg', 2: 'https://files.catbox.moe/8kk4je.ogg',
    3: 'https://files.catbox.moe/8kk4je.ogg', 4: 'https://files.catbox.moe/8kk4je.ogg', 5: 'https://files.catbox.moe/8kk4je.ogg',
};

const snd = {
    nightStart: au('https://files.catbox.moe/x39e6b.ogg', false, 0.6), winMelody:  au('https://files.catbox.moe/esjta4.ogg', false, 0.6),
    amb: au('https://files.catbox.moe/ad5yrw.mp3', true, 0.2), camUp: au('https://files.catbox.moe/d8qyqe.mp3', false, 0.5),
    camDown: au('https://files.catbox.moe/hljkyi.mp3', false, 0.5), camSw: au('https://files.catbox.moe/4a9er6.mp3', false, 0.4),
    dClose: au('https://files.catbox.moe/xrln60.mp3', false, 0.6), dOpen: au('https://files.catbox.moe/i0tyqu.mp3', false, 0.5),
    pwrOut: au('https://files.catbox.moe/hvxd67.mp3', false, 0.7), pwrOn: au('https://files.catbox.moe/zuy3mk.mp3', false, 0.7),
    scare: au('https://files.catbox.moe/bfucts.mp3', false, 1.0), win: au('https://files.catbox.moe/13m0my.mp3', false, 0.8),
    noise: au('https://files.catbox.moe/wn4b5f.mp3', true, 0.08), phone: null
};

function play(a) { if (!a) return; try { a.currentTime = 0; const p = a.play(); if (p && p.catch) p.catch(()=>{}); } catch(e) {} }
function stop(a) { if (!a) return; try { a.pause(); a.currentTime = 0; } catch(e) {} }

document.getElementById('audioUnlock').addEventListener('click', function() {
    this.style.display = 'none';
    try { snd.amb.play().catch(()=>{}); snd.amb.pause(); } catch(e) {}
});

const canvas = document.getElementById('camCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const frameImg = new Image();

window.toggleFullScreen = function() {
    const elem = document.documentElement;
    if (!document.fullscreenElement) { elem.requestFullscreen().catch(()=>{}); document.getElementById('fsBtn').textContent = '[ ✖ EXIT FS ]'; }
    else { if (document.exitFullscreen) { document.exitFullscreen(); document.getElementById('fsBtn').textContent = '[ ⛶ FULLSCREEN ]'; } }
};

window.resetBreaker = function() { socket.emit('resetBreaker', gameId); };

socket.emit('joinAsGuard', gameId, res => {
    if (!res || !res.success) return;
    S = res.state; mode = S.mode; init();
});

function init() {
    if (mode === 2) {
        const off = document.getElementById('office'); if (off) off.style.display = 'block';
        const cc = document.getElementById('camCont'); if (cc) cc.classList.add('mode2-down');
        const mon = document.getElementById('officeMonBtn');
        if (mon) { mon.addEventListener('click', toggleCams); mon.addEventListener('touchend', e => { e.preventDefault(); toggleCams(); }); }
    } else {
        const cc = document.getElementById('camCont'); if (cc) cc.classList.add('mode1-hidden');
    }
    buildDoors(); buildCamBtns(); buildTouchBar(); updateUI();
}

const DOOR_NAMES = ['L', 'R', 'B'];

function buildDoors() {
    const hud = document.getElementById('doorStatusHud');
    if (!hud) return;
    let html = ''; const count = S ? S.doorCount : 2;
    for(let i = 0; i < count; i++) { html += `<div class="mini-door-frame" id="miniDoor${i}"><div class="mini-door-label">${DOOR_NAMES[i]}</div><div class="mini-door-metal"></div></div>`; }
    hud.innerHTML = html;
}

function doDoor(i) { socket.emit('toggleDoor', { gameId, doorIndex: i }); }

function buildCamBtns() {
    const box = document.getElementById('camBtns');
    if (!box) return; let h = '';
    if (S && S.cameras) {
        S.cameras.forEach((c, i) => { const cls = c.connected ? (c.broken ? 'broken' : '') : 'off'; h += `<div class="cam-btn-item ${cls} ${i===curCam&&camsUp?'active':''}" id="cBtn${i}">CAM ${i+1}</div>`; });
    }
    box.innerHTML = h;
    if (S && S.cameras) {
        S.cameras.forEach((c, i) => {
            const el = document.getElementById('cBtn' + i);
            if (!el) return;
            const fn = () => { if (camsUp && c.connected) switchCam(i); };
            el.addEventListener('click', fn); el.addEventListener('touchend', e => { e.preventDefault(); fn(); });
        });
    }
}

function buildTouchBar() {
    const bar = document.getElementById('touchBar');
    if (!bar) return;
    let h = `<div class="touch-btn" id="tCam">📷 CAM</div>`;
    const count = S ? S.doorCount : 2;
    for(let i = 0; i < count; i++) { h += `<div class="touch-btn" id="tDoor${i}">🚪 DOOR ${i+1}</div>`; }
    bar.innerHTML = h;

    const camBtn = document.getElementById('tCam');
    if (camBtn) { camBtn.addEventListener('click', toggleCams); camBtn.addEventListener('touchend', e => { e.preventDefault(); toggleCams(); }); }
    for(let i = 0; i < count; i++) {
        const el = document.getElementById('tDoor' + i);
        if (el) { el.addEventListener('click', () => doDoor(i)); el.addEventListener('touchend', e => { e.preventDefault(); doDoor(i); }); }
    }
}

function toggleCams() { socket.emit('toggleCameras', gameId); }
function switchCam(i) { socket.emit('switchCamera', { gameId, camIndex: i }); }

function doReboot() {
    if (!S || !S.systemOff || rebooting || S.isDeadPower) return;
    rebooting = true; rebootT0 = Date.now();
    socket.emit('startReboot', gameId);
}

const bigRb = document.getElementById('bigRebootBtn');
if (bigRb) { bigRb.addEventListener('click', doReboot); bigRb.addEventListener('touchend', e => { e.preventDefault(); doReboot(); }); }

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

socket.on('gameStarted', st => {
    S = st; mode = st.mode; updateUI(); play(snd.nightStart);
    snd.nightStart.onended = () => { play(snd.amb); playPhone(st.night); };
});

socket.on('gameState', st => { S = st; updateUI(); });

socket.on('camerasToggled', d => { S = d.state; camsUp = d.camerasUp; updateCamView(); if (camsUp) play(snd.camUp); else play(snd.camDown); });
socket.on('cameraSwitched', d => { S = d.state; curCam = d.currentCamera; updateCamView(); play(snd.camSw); });

socket.on('doorToggled', d => {
    S = d.state;
    const miniFrame = document.getElementById('miniDoor' + d.doorIndex);
    const tBtn = document.getElementById('tDoor' + d.doorIndex);
    if (miniFrame) {
        miniFrame.classList.remove('anim-close','anim-open'); void miniFrame.offsetWidth; 
        if (d.closed) { miniFrame.classList.add('anim-close','shut'); play(snd.dClose); } 
        else { miniFrame.classList.remove('shut'); miniFrame.classList.add('anim-open'); play(snd.dOpen); }
    }
    if (tBtn) tBtn.classList.toggle('door-closed', d.closed);
});

socket.on('doorAnimDone', d => {
    S = d.state;
    if (d.state && d.state.doors) {
        d.state.doors.forEach((dr, i) => {
            const mf = document.getElementById('miniDoor' + i);
            if (mf) { if (dr.closed) { mf.classList.add('shut'); mf.classList.remove('anim-open'); } else { mf.classList.remove('shut', 'anim-close'); } }
        });
    }
});

socket.on('cameraFrame', d => {
    if (!camsUp || curCam !== d.camIndex) return;
    if (d.broken) { showBroken(); return; }
    const ns = document.getElementById('noSig'); if (ns) ns.style.display = 'none';
    frameImg.onload = () => { if (canvas && ctx) { canvas.width = frameImg.width; canvas.height = frameImg.height; ctx.drawImage(frameImg, 0, 0); } };
    frameImg.src = d.frameData;
});

socket.on('cameraBrokenNotify', d => { S = d.state; buildCamBtns(); if (camsUp && curCam === d.camIndex) showBroken(); });
socket.on('cameraRepairedNotify', d => { S = d.state; buildCamBtns(); if (camsUp && curCam === d.camIndex) { const ns = document.getElementById('noSig'); if (ns) ns.style.display = 'none'; } });

socket.on('powerOut', st => {
    S = st; camsUp = false; updateCamView();
    const po = document.getElementById('pwrOut'); if (po) po.classList.add('on');
    stop(snd.amb); stop(snd.noise); stop(snd.nightStart); if (snd.phone) stop(snd.phone);

    const fVid = document.getElementById('freddyVid');
    const bigBtn = document.getElementById('bigRebootBtn');

    if (S.isDeadPower) {
        if (bigBtn) bigBtn.style.display = 'none';
        if (fVid) { fVid.style.display = 'block'; fVid.currentTime = 0; fVid.play().catch(()=>{}); }
    } else {
        if (fVid) { fVid.pause(); fVid.style.display = 'none'; }
        if (bigBtn) bigBtn.style.display = 'block';
    }
    play(snd.pwrOut);
});

socket.on('rebootStarted', st => {
    S = st;
    const bigBtn = document.getElementById('bigRebootBtn'); if (bigBtn) bigBtn.style.display = 'none';
    const rb = document.getElementById('rebootBar'); if (rb) rb.style.display = 'block';
    const rm = document.getElementById('rebootMsg'); if (rm) rm.textContent = 'REBOOTING SYSTEMS...';
    animReboot();
});

socket.on('rebootWaitingApproval', st => { S = st; const rf = document.getElementById('rebootFill'); if (rf) rf.style.width = '100%'; const rm = document.getElementById('rebootMsg'); if (rm) rm.textContent = 'WAITING FOR APPROVAL...'; });

socket.on('rebootApproved', st => {
    S = st; rebooting = false;
    const po = document.getElementById('pwrOut'); if (po) po.classList.remove('on');
    const rb = document.getElementById('rebootBar'); if (rb) rb.style.display = 'none';
    const rm = document.getElementById('rebootMsg'); if (rm) rm.textContent = '';
    
    doFlash(); play(snd.pwrOn); play(snd.amb); updateUI();
});

socket.on('rebootDenied', st => {
    S = st; rebooting = false;
    const rb = document.getElementById('rebootBar'); if (rb) rb.style.display = 'none';
    const rm = document.getElementById('rebootMsg'); if (rm) rm.textContent = 'REBOOT DENIED. Try again.';
    const bigBtn = document.getElementById('bigRebootBtn'); if (bigBtn) bigBtn.style.display = 'block';
});

socket.on('gameLost', d => {
    S = d; stop(snd.amb); stop(snd.noise); stop(snd.nightStart); if (snd.phone) stop(snd.phone);
    const fVid = document.getElementById('freddyVid'); if (fVid) fVid.pause();
    play(snd.scare); const ss = document.getElementById('scareScr'); if (ss) ss.classList.add('on');
});

socket.on('gameWon', st => {
    S = st; stop(snd.amb); stop(snd.noise); stop(snd.nightStart); if (snd.phone) stop(snd.phone);
    const fVid = document.getElementById('freddyVid'); if (fVid) fVid.pause();
    const po = document.getElementById('pwrOut'); if (po) po.classList.remove('on');
    const ws = document.getElementById('winScr'); if (ws) ws.classList.add('on');
    const slide = document.getElementById('digitSlide'); if (slide) slide.classList.remove('shift');

    setTimeout(() => { if (slide) slide.classList.add('shift'); play(snd.win); spawnConf(); }, 1000);
    snd.win.onended = () => { play(snd.winMelody); };
});

function updateUI() {
    if (!S) return;
    const ht = document.getElementById('hTime'); if (ht) ht.textContent = S.hourString;
    const p = Math.round(S.power); const pe = document.getElementById('hPwr');
    if (pe) { pe.textContent = p + '%'; pe.className = 'pwr-val ' + (p <= 15 ? 'lo' : p <= 40 ? 'md' : 'hi'); }

    let bars = 1; if (S.camerasUp) bars++; if (S.doors) S.doors.forEach(d => { if (d.closed) bars++; });
    const hu = document.getElementById('hUsage'); if (hu) hu.textContent = 'Usage: ' + '█'.repeat(bars);

    if (S.doorOverloadEnabled && S.overloadLevel > 0 && !S.overloadTripped) {
        document.getElementById('overloadHud').style.display = 'block';
        document.getElementById('overloadFill').style.width = S.overloadLevel + '%';
        if (S.overloadLevel > 80) document.getElementById('overloadFill').classList.add('danger');
        else document.getElementById('overloadFill').classList.remove('danger');
    } else { document.getElementById('overloadHud').style.display = 'none'; }

    if (S.overloadTripped) document.getElementById('breakerScreen').classList.add('on');
    else document.getElementById('breakerScreen').classList.remove('on');

    if (S.doors) {
        S.doors.forEach((d, i) => {
            const mf = document.getElementById('miniDoor' + i);
            if (mf && !d.animating) { if (d.closed) mf.classList.add('shut'); else mf.classList.remove('shut'); }
        });
    }

    camsUp = S.camerasUp; curCam = S.currentCamera; updateCamView();
    const po = document.getElementById('pwrOut');
    if (po && S.systemOff && !S.isDeadPower) { po.classList.add('on'); const br = document.getElementById('bigRebootBtn'); if (br) br.style.display = 'block'; }
}

function updateCamView() {
    const cc = document.getElementById('camCont');
    if (cc) {
        if (mode === 1) cc.classList.toggle('mode1-hidden', !camsUp);
        else { cc.classList.toggle('mode2-up', camsUp); cc.classList.toggle('mode2-down', !camsUp); }
    }
    const tCam = document.getElementById('tCam'); if (tCam) tCam.classList.toggle('on', camsUp);
    const cl = document.getElementById('camLbl'); if (cl) cl.textContent = 'CAM ' + (curCam + 1);

    if (S && S.cameras) {
        S.cameras.forEach((c, i) => {
            const el = document.getElementById('cBtn' + i);
            if (!el) return;
            el.classList.toggle('active', i === curCam && camsUp);
            el.classList.toggle('broken', c.broken);
            el.classList.toggle('off', !c.connected);
        });
    }

    if (camsUp && S && S.cameras && S.cameras[curCam]) {
        const c = S.cameras[curCam]; const ns = document.getElementById('noSig');
        if (c.broken) showBroken();
        else if (!c.connected) { if (ns) { ns.style.display = 'block'; ns.textContent = 'NO SIGNAL'; } }
        else { if (ns) ns.style.display = 'none'; }
    }
    if (camsUp) play(snd.noise); else stop(snd.noise);
}

function showBroken() { const ns = document.getElementById('noSig'); if (ns) { ns.style.display = 'block'; ns.innerHTML = 'CAMERA MALFUNCTION<br><span style="color:var(--yellow);font-size:.7em;">Repair from camera device</span>'; } drawNoise(); }

function drawNoise() {
    if (!canvas || !ctx) return;
    canvas.width = 320; canvas.height = 240;
    const d = ctx.createImageData(320, 240);
    for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = v; d.data[i+1] = v; d.data[i+2] = v; d.data[i+3] = 255; }
    ctx.putImageData(d, 0, 0);
}

function animReboot() {
    if (!rebooting) return;
    const p = Math.min((Date.now() - rebootT0) / 15000, 1);
    const rf = document.getElementById('rebootFill'); if (rf) rf.style.width = (p * 100) + '%';
    if (p < 1) requestAnimationFrame(animReboot);
}

function doFlash() { const f = document.getElementById('flash'); if (!f) return; f.classList.add('pop'); setTimeout(() => f.classList.remove('pop'), 120); }

function playPhone(night) {
    const callUrl = PHONE_CALL_URLS[night];
    if (!callUrl) return;
    const muteBtn = document.getElementById('muteCallBtn'); if (muteBtn) muteBtn.style.display = 'block';
    snd.phone = au(callUrl, false, 0.7);
    setTimeout(() => { if (!S || S.state !== 'playing' || S.systemOff) return; play(snd.phone); }, 1000);
    snd.phone.onended = () => { if (muteBtn) muteBtn.style.display = 'none'; socket.emit('phoneCallDone', gameId); };
}

window.mutePhoneCall = function() { if (snd.phone) stop(snd.phone); const muteBtn = document.getElementById('muteCallBtn'); if (muteBtn) muteBtn.style.display = 'none'; socket.emit('phoneCallDone', gameId); };

function spawnConf() {
    const box = document.getElementById('confBox'); if (!box) return;
    const cols = ['#ff0040','#00ff41','#ffaa00','#0088ff','#ff00ff','#00ffff','#fff'];
    for (let i = 0; i < 80; i++) {
        const c = document.createElement('div'); c.className = 'confetti-piece'; c.style.left = Math.random() * 100 + '%'; c.style.background = cols[Math.floor(Math.random() * cols.length)]; c.style.animationDuration = (2 + Math.random() * 3) + 's'; c.style.animationDelay = Math.random() * 2 + 's'; c.style.width = (5 + Math.random() * 8) + 'px'; c.style.height = (5 + Math.random() * 8) + 'px'; box.appendChild(c);
    }
}
})();
