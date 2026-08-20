(function(){
const socket = io();
const params = new URLSearchParams(location.search);
const gameId = params.get('game');
const camIndex = parseInt(params.get('cam')) || 0;

if (!gameId) {
    document.body.innerHTML = '<div style="color:red;padding:40px;font-family:monospace;">No game ID</div>';
    return;
}

document.getElementById('camIdx').textContent = 'CAM ' + (camIndex + 1);

const vid = document.getElementById('vid');
const capCvs = document.getElementById('capCvs');
const capCtx = capCvs.getContext('2d');
const statusTxt = document.getElementById('statusTxt');
const btnEnable = document.getElementById('btnEnableCam');
const btnRepair = document.getElementById('btnRepair');
const repairBox = document.getElementById('repairBox');
const repairBar = document.getElementById('repairBar');
const repairFill = document.getElementById('repairFill');
const repairStatus = document.getElementById('repairStatus');
const brokenFull = document.getElementById('brokenFull');

// ===== ВСЕ ЗВУКИ КАМЕРЫ =====
function au(src, loop, vol) {
    const a = new Audio(src);
    a.loop = !!loop;
    a.volume = vol !== undefined ? vol : 0.4;
    return a;
}

const snd = {
    nightStart: au('https://files.catbox.moe/8y8z75.mp3', false, 0.5), // Мелодия старта
    winMelody:  au('https://files.catbox.moe/win_melody.mp3', false, 0.5),  // Триумфальная музыка

    camUp:     au('/audio/camera_up.mp3', false, 0.4),
    camDown:   au('/audio/camera_down.mp3', false, 0.4),
    camSw:     au('/audio/camera_switch.mp3', false, 0.3),
    camBroken: au('/audio/camera_broken.mp3', false, 0.8),
    noise:     au('/audio/static.mp3', true, 0.25),
    dClose:    au('/audio/door_close.mp3', false, 0.5),
    dOpen:     au('/audio/door_open.mp3', false, 0.4),
    pwrOut:    au('/audio/power_out.mp3', false, 0.6),
    pwrOn:     au('/audio/power_on.mp3', false, 0.6),
    scare:     au('/audio/jumpscare.mp3', false, 0.9),
    win:       au('/audio/win.mp3', false, 0.7)
};

function play(a) { try { a.currentTime = 0; a.play(); } catch(e) {} }
function stop(a) { try { a.pause(); a.currentTime = 0; } catch(e) {} }

let streaming = false;
let broken = false;
let repairing = false;
let repairT0 = 0;
let sendTimer = null;

socket.emit('joinAsCamera', { gameId, camIndex }, res => {
    if (!res.success) {
        statusTxt.textContent = 'Error: ' + (res.error || 'Unknown');
        statusTxt.style.color = 'var(--red)';
        return;
    }
    statusTxt.textContent = 'Connected! Enable camera below.';
    btnEnable.style.display = 'inline-block';
    startCam();
});

btnEnable.addEventListener('click', startCam);
btnEnable.addEventListener('touchend', e => { e.preventDefault(); startCam(); });

async function startCam() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false
        });
        vid.srcObject = stream;
        vid.style.display = 'block';
        btnEnable.style.display = 'none';
        statusTxt.textContent = 'Camera active — streaming';
        statusTxt.style.color = 'var(--green)';
        streaming = true;
        sendTimer = setInterval(sendFrame, 200);
    } catch(err) {
        statusTxt.textContent = 'Camera denied: ' + err.message;
        statusTxt.style.color = 'var(--red)';
        btnEnable.style.display = 'inline-block';
    }
}

function sendFrame() {
    if (!streaming || broken) return;
    capCvs.width = 320; capCvs.height = 240;
    capCtx.drawImage(vid, 0, 0, 320, 240);
    capCtx.fillStyle = 'rgba(0,255,0,.02)';
    capCtx.fillRect(0, 0, 320, 240);
    capCtx.fillStyle = 'rgba(255,255,255,.6)';
    capCtx.font = '10px monospace';
    capCtx.fillText(new Date().toLocaleTimeString(), 5, 235);
    capCtx.fillText('CAM ' + (camIndex + 1), 255, 235);
    const data = capCvs.toDataURL('image/jpeg', 0.45);
    socket.emit('cameraFrame', { gameId, camIndex, frameData: data });
}

btnRepair.addEventListener('click', doRepair);
btnRepair.addEventListener('touchend', e => { e.preventDefault(); doRepair(); });

function doRepair() {
    if (!broken || repairing) return;
    repairing = true;
    repairT0 = Date.now();
    repairBar.style.display = 'block';
    repairStatus.textContent = 'Repairing...';
    btnRepair.disabled = true;
    socket.emit('startRepairCamera', { gameId, camIndex });
    animRepair();
}

function animRepair() {
    if (!repairing) return;
    const p = Math.min((Date.now() - repairT0) / 20000, 1);
    repairFill.style.width = (p * 100) + '%';
    if (p < 1) requestAnimationFrame(animRepair);
}

// ===== СОБЫТИЯ И ЗВУКИ =====

socket.on('cameraBroken', () => {
    broken = true;
    brokenFull.classList.add('on');
    repairBox.classList.add('on');
    btnRepair.disabled = false;
    repairBar.style.display = 'none';
    repairStatus.textContent = '';
    repairing = false;
    statusTxt.textContent = 'CAMERA BROKEN!';
    statusTxt.style.color = 'var(--red)';
    play(snd.camBroken);
    try { snd.noise.play(); } catch(e) {}
});

socket.on('cameraRepaired', () => {
    broken = false;
    repairing = false;
    brokenFull.classList.remove('on');
    repairBox.classList.remove('on');
    repairBar.style.display = 'none';
    repairStatus.textContent = '';
    statusTxt.textContent = 'Camera active — streaming';
    statusTxt.style.color = 'var(--green)';
    stop(snd.noise);
});

socket.on('camerasToggled', d => {
    if (d.camerasUp) { play(snd.camUp); } else { play(snd.camDown); }
});

socket.on('cameraSwitched', () => { play(snd.camSw); });

socket.on('doorToggled', d => {
    if (d.closed) { play(snd.dClose); } else { play(snd.dOpen); }
});

socket.on('powerOut', () => {
    stop(snd.nightStart);
    play(snd.pwrOut);
    statusTxt.textContent = '⚠️ POWER OUT!';
    statusTxt.style.color = 'var(--red)';
});

socket.on('rebootApproved', () => {
    play(snd.pwrOn);
    if (!broken) {
        statusTxt.textContent = 'Camera active — streaming';
        statusTxt.style.color = 'var(--green)';
    }
});

// ПОБЕДА (на камере)
socket.on('gameWon', () => {
    streaming = false;
    if (sendTimer) clearInterval(sendTimer);
    stop(snd.noise);
    stop(snd.nightStart);
    
    // Включаем сирену победы
    play(snd.win);
    document.getElementById('winEnd').classList.add('on');

    // Сразу после сирены включаем финальную музыку
    snd.win.onended = () => {
        play(snd.winMelody);
    };
});

// ПРОИГРЫШ (на камере)
socket.on('gameLost', () => {
    streaming = false;
    if (sendTimer) clearInterval(sendTimer);
    stop(snd.noise);
    stop(snd.nightStart);
    play(snd.scare);
    document.getElementById('loseEnd').classList.add('on');
});

// НАЧАЛО ИГРЫ (на камере)
socket.on('gameStarted', () => {
    statusTxt.textContent = 'NIGHT STARTED — Camera active';
    play(snd.nightStart);
});

})();
