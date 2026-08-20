(function(){
const socket = io();
const params = new URLSearchParams(location.search);
const gameId = params.get('game');

if (!gameId) {
    document.body.innerHTML = '<div style="color:red;padding:40px;font-family:monospace;">No game ID</div>';
    return;
}

let S = null;
let connected = false;

const $ = id => document.getElementById(id);

// Connect
$('btnConnect').addEventListener('click', doConnect);

function doConnect() {
    const name = $('animName').value || 'Freddy';
    $('connectMsg').textContent = 'Connecting...';

    socket.emit('joinAsAnimatronic', { gameId, name }, res => {
        if (!res.success) {
            $('connectMsg').textContent = 'Error: ' + (res.error || '');
            return;
        }
        connected = true;
        $('pConnect').style.display = 'none';
        $('pStatus').style.display = 'block';
        $('pSabotage').style.display = 'block';
        $('pAttack').style.display = 'block';
    });
}

// Kill power
$('btnKillPwr').addEventListener('click', () => {
    socket.emit('killPower', { gameId });
    $('btnKillPwr').disabled = true;
    $('btnKillPwr').textContent = '⚡ POWER KILLED';
});

// Jumpscare
$('btnScare').addEventListener('click', () => {
    if (confirm('Trigger jumpscare? This ends the game!')) {
        socket.emit('jumpscare', { gameId });
    }
});

// Reboot approve/deny
$('btnApprove').addEventListener('click', () => {
    socket.emit('approveReboot', { gameId });
    $('pReboot').style.display = 'none';
    $('btnKillPwr').disabled = false;
    $('btnKillPwr').textContent = '⚡ KILL POWER';
});

$('btnDeny').addEventListener('click', () => {
    socket.emit('denyReboot', { gameId });
    $('pReboot').style.display = 'none';
});

// Break camera
window.breakCam = function(i) {
    socket.emit('breakCamera', { gameId, camIndex: i });
};

// State updates
function updateUI(st) {
    if (!st || !connected) return;
    S = st;

    $('aTime').textContent = st.hourString;

    const p = Math.round(st.power);
    $('aPwr').textContent = p + '%';
    $('aPwr').style.color = p <= 15 ? 'var(--red)' : p <= 40 ? 'var(--yellow)' : 'var(--green)';

    $('aCams').textContent = st.camerasUp ? 'UP 👁️' : 'DOWN';
    $('aCams').style.color = st.camerasUp ? 'var(--green)' : 'var(--red)';

    let dh = 'Doors: ';
    st.doors.forEach((d, i) => {
        const c = d.closed ? 'var(--red)' : 'var(--green)';
        const t = d.closed ? 'CLOSED' : 'OPEN';
        dh += `D${i+1}:<span style="color:${c}"> ${t}</span> `;
    });
    $('aDoors').innerHTML = dh;

    $('aSys').textContent = st.systemOff ? 'OFF ❌' : 'ON ✓';
    $('aSys').style.color = st.systemOff ? 'var(--red)' : 'var(--green)';

    // Camera buttons
    let ch = '';
    st.cameras.forEach((cam, i) => {
        if (!cam.connected) return;
        const dis = cam.broken ? 'disabled' : '';
        const txt = cam.broken ? `📷 CAM ${i+1} — BROKEN` : `📷 BREAK CAM ${i+1}`;
        ch += `<button class="anim-btn" onclick="breakCam(${i})" ${dis}>${txt}</button>`;
    });
    $('camActions').innerHTML = ch;

    if (st.systemOff) {
        $('btnKillPwr').disabled = true;
        $('btnKillPwr').textContent = '⚡ POWER IS OFF';
    }
}

socket.on('gameState', updateUI);
socket.on('gameStarted', updateUI);
socket.on('powerOut', updateUI);
socket.on('cameraBrokenNotify', d => updateUI(d.state));
socket.on('cameraRepairedNotify', d => updateUI(d.state));

socket.on('rebootWaitingApproval', st => {
    S = st;
    $('pReboot').style.display = 'block';
});

socket.on('rebootApproved', st => {
    $('pReboot').style.display = 'none';
    updateUI(st);
});

socket.on('rebootDenied', st => {
    $('pReboot').style.display = 'none';
    updateUI(st);
});

socket.on('gameWon', () => $('winEnd').classList.add('on'));
socket.on('gameLost', () => $('loseEnd').classList.add('on'));

})();