(function(){
const socket = io();
const params = new URLSearchParams(location.search);
const gameId = params.get('game');
const camIndex = parseInt(params.get('cam')) || 0;

if (!gameId) { document.body.innerHTML = '<div style="color:red;padding:40px;font-family:monospace;">No game ID</div>'; return; }

const ci = document.getElementById('camIdx'); if (ci) ci.textContent = 'CAM ' + (camIndex + 1);

const vid = document.getElementById('vid');
const capCvs = document.getElementById('capCvs');
const capCtx = capCvs ? capCvs.getContext('2d') : null;
const statusTxt = document.getElementById('statusTxt');
const btnEnable = document.getElementById('btnEnableCam');
const btnRepair = document.getElementById('btnRepair');
const repairBar = document.getElementById('repairBar');
const repairFill = document.getElementById('repairFill');
const repairStatus = document.getElementById('repairStatus');
const brokenFull = document.getElementById('brokenFull');

function au(src, loop, vol) {
    const a = new Audio(); a.loop = !!loop; a.volume = vol !== undefined ? vol : 0.4;
    a.onerror = () => { console.warn('Audio failed:', src); }; a.src = src; return a;
}

// 🔊 ВСЕ ЗВУКИ КАМЕРЫ С РАБОЧИМИ ССЫЛКАМИ (БЕЗ 13m0my.mp3)
const snd = {
    nightStart: au('https://files.catbox.moe/x39e6b.ogg', false, 0.5),
    winMelody:  au('https://files.catbox.moe/esjta4.ogg', false, 0.5),
    camUp:      au('https://files.catbox.moe/d8qyqe.mp3', false, 0.4),
    camDown:    au('https://files.catbox.moe/d8qyqe.mp3', false, 0.4),
    camSw:      au('https://files.catbox.moe/4a9er6.mp3', false, 0.3),
    camBroken:  au('https://files.catbox.moe/hvxd67.mp3', false, 0.8),
    noise:      au('https://files.catbox.moe/wn4b5f.mp3', true, 0.25),
    dClose:     au('https://files.catbox.moe/xrln60.mp3', false, 0.5),
    dOpen:      au('https://files.catbox.moe/i0tyqu.mp3', false, 0.4),
    pwrOut:     au('https://files.catbox.moe/hvxd67.mp3', false, 0.6),
    pwrOn:      au('https://files.catbox.moe/zuy3mk.mp3', false, 0.6),
    scare:      au('https://files.catbox.moe/bfucts.mp3', false, 0.9),
    win:        au('https://files.catbox.moe/zuy3mk.mp3', false, 0.7), // РАБОЧАЯ ЗАМЕНА
    distraction: au('https://files.catbox.moe/xrln60.mp3', false, 1.0)
};

function play(a) { if (!a) return; try { a.currentTime = 0; const p = a.play(); if (p && p.catch) p.catch(()=>{}); } catch(e) {} }
function stop(a) { if (!a) return; try { a.pause(); a.currentTime = 0; } catch(e) {} }

let streaming = false; let broken = false; let repairing = false; let repairT0 = 0; let sendTimer = null;

socket.emit('joinAsCamera', { gameId, camIndex }, res => {
    if (!res || !res.success) {
        if (statusTxt) { statusTxt.textContent = 'Error: ' + (res ? res.error : 'Unknown'); statusTxt.style.color = 'var(--red)'; } return;
    }
    if (statusTxt) statusTxt.textContent = 'Connected! Enable camera below.';
    if (btnEnable) btnEnable.style.display = 'inline-block';
    if (res.isBroken) triggerBrokenState();
    startCam();
});

if (btnEnable) btnEnable.addEventListener('click', startCam);

async function startCam() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
        if (vid) { vid.srcObject = stream; vid.style.display = 'block'; }
        if (btnEnable) btnEnable.style.display = 'none';
        if (statusTxt && !broken) { statusTxt.textContent = 'Camera active — streaming'; statusTxt.style.color = 'var(--green)'; }
        streaming = true;
        if (!sendTimer) sendTimer = setInterval(sendFrame, 200);
    } catch(err) {
        if (statusTxt) { statusTxt.textContent = 'Camera denied: ' + err.message; statusTxt.style.color = 'var(--red)'; }
        if (btnEnable) btnEnable.style.display = 'inline-block';
    }
}

function sendFrame() {
    if (!streaming || broken || !capCvs || !capCtx || !vid) return;
    capCvs.width = 320; capCvs.height = 240;
    capCtx.drawImage(vid, 0, 0, 320, 240);
    capCtx.fillStyle = 'rgba(0,255,0,.02)'; capCtx.fillRect(0, 0, 320, 240);
    capCtx.fillStyle = 'rgba(255,255,255,.6)'; capCtx.font = '10px monospace';
    capCtx.fillText(new Date().toLocaleTimeString(), 5, 235); capCtx.fillText('CAM ' + (camIndex + 1), 255, 235);
    const data = capCvs.toDataURL('image/jpeg', 0.45);
    socket.emit('cameraFrame', { gameId, camIndex, frameData: data });
}

if (brokenFull) { brokenFull.addEventListener('click', doRepair); brokenFull.addEventListener('touchend', e => { e.preventDefault(); doRepair(); }); }

function doRepair() {
    if (repairing) return;
    broken = true; repairing = true; repairT0 = Date.now();
    if (repairBar) repairBar.style.display = 'block';
    if (repairStatus) repairStatus.textContent = 'REPAIRING... (20s)';
    if (btnRepair) btnRepair.style.display = 'none';
    socket.emit('startRepairCamera', { gameId, camIndex });
    animRepair();
}

function animRepair() {
    if (!repairing) return;
    const p = Math.min((Date.now() - repairT0) / 20000, 1);
    if (repairFill) repairFill.style.width = (p * 100) + '%';
    if (p < 1) requestAnimationFrame(animRepair);
}

function triggerBrokenState() {
    broken = true; repairing = false;
    if (brokenFull) brokenFull.classList.add('on');
    if (btnRepair) { btnRepair.style.display = 'inline-block'; }
    if (repairBar) repairBar.style.display = 'none';
    if (repairStatus) repairStatus.textContent = '';
    play(snd.camBroken); play(snd.noise);
}

socket.on('playDistractionSound', () => { play(snd.distraction); });

socket.on('cameraBroken', (data) => { if (data && typeof data.camIndex === 'number' && data.camIndex !== camIndex) return; triggerBrokenState(); });

socket.on('cameraRepaired', (data) => {
    if (data && typeof data.camIndex === 'number' && data.camIndex !== camIndex) return;
    broken = false; repairing = false;
    if (brokenFull) brokenFull.classList.remove('on');
    if (repairBar) repairBar.style.display = 'none';
    if (repairStatus) repairStatus.textContent = '';
    if (statusTxt) { statusTxt.textContent = 'Camera active — streaming'; statusTxt.style.color = 'var(--green)'; }
    stop(snd.noise);
});

socket.on('gameState', (st) => {
    if (st && st.cameras && st.cameras[camIndex]) {
        const c = st.cameras[camIndex];
        if (c.broken && !broken && !repairing) triggerBrokenState();
    }
});

socket.on('camerasToggled', d => { if (d.camerasUp) play(snd.camUp); else play(snd.camDown); });
socket.on('cameraSwitched', () => { play(snd.camSw); });
socket.on('doorToggled', d => { if (d.closed) play(snd.dClose); else play(snd.dOpen); });
socket.on('powerOut', () => { stop(snd.nightStart); play(snd.pwrOut); });
socket.on('rebootApproved', () => { play(snd.pwrOn); });

socket.on('gameWon', () => {
    streaming = false; if (sendTimer) clearInterval(sendTimer);
    stop(snd.noise); stop(snd.nightStart); play(snd.win);
    const we = document.getElementById('winEnd'); if (we) we.classList.add('on');
    snd.win.onended = () => { play(snd.winMelody); };
});

socket.on('gameLost', () => {
    streaming = false; if (sendTimer) clearInterval(sendTimer);
    stop(snd.noise); stop(snd.nightStart); play(snd.scare);
    const le = document.getElementById('loseEnd'); if (le) le.classList.add('on');
});

socket.on('gameStarted', () => { play(snd.nightStart); });
})();
