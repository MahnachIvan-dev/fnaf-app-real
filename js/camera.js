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

let streaming = false;
let broken = false;
let repairing = false;
let repairT0 = 0;
let sendTimer = null;

// Join
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

// Enable camera
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

    // Green tint
    capCtx.fillStyle = 'rgba(0,255,0,.02)';
    capCtx.fillRect(0, 0, 320, 240);

    // Timestamp
    capCtx.fillStyle = 'rgba(255,255,255,.6)';
    capCtx.font = '10px monospace';
    capCtx.fillText(new Date().toLocaleTimeString(), 5, 235);
    capCtx.fillText('CAM ' + (camIndex + 1), 255, 235);

    const data = capCvs.toDataURL('image/jpeg', 0.45);
    socket.emit('cameraFrame', { gameId, camIndex, frameData: data });
}

// Repair — кнопка на самой камере (телефоне)
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

// Camera broken
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
});

// Camera repaired
socket.on('cameraRepaired', () => {
    broken = false;
    repairing = false;
    brokenFull.classList.remove('on');
    repairBox.classList.remove('on');
    repairBar.style.display = 'none';
    repairStatus.textContent = '';
    statusTxt.textContent = 'Camera active — streaming';
    statusTxt.style.color = 'var(--green)';
});

// Game events
socket.on('gameWon', () => {
    streaming = false;
    if (sendTimer) clearInterval(sendTimer);
    document.getElementById('winEnd').classList.add('on');
});

socket.on('gameLost', () => {
    streaming = false;
    if (sendTimer) clearInterval(sendTimer);
    document.getElementById('loseEnd').classList.add('on');
});

socket.on('gameStarted', () => {
    statusTxt.textContent = 'NIGHT STARTED — Camera active';
});

})();