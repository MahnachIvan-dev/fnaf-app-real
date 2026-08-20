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

// ===== ВСЕ ЗВУКИ АНИМАТРОНИКА =====
function au(src, loop, vol) {
    const a = new Audio(src);
    a.loop = !!loop;
    a.volume = vol !== undefined ? vol : 0.4;
    return a;
}

const snd = {
    nightStart: au('https://files.catbox.moe/8y8z75.mp3', false, 0.5), // Старт ночи
    winMelody:  au('https://files.catbox.moe/win_melody.mp3', false, 0.5),  // Триумфальная музыка

    pwrOut: au('/audio/power_out.mp3', false, 0.6),
    pwrOn:  au('/audio/power_on.mp3', false, 0.6),
    scare:  au('/audio/jumpscare.mp3', false, 0.9),
    win:    au('/audio/win.mp3', false, 0.7)
};

function play(a) { try { a.currentTime = 0; a.play(); } catch(e) {} }
function stop(a) { try { a.pause(); a.currentTime = 0; } catch(e) {} }

// Connect
$('btnConnect').addEventListener('click', () => {
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
});

$('btnKillPwr').addEventListener('click', () => {
    socket.emit('killPower', { gameId });
    $('btnKillPwr').disabled = true;
    $('btnKillPwr').textContent = '⚡ POWER KILLED';
});

$('btnScare').addEventListener('click', () => {
    if (confirm('Trigger jumpscare? This ends the game!')) {
        socket.emit('jumpscare', { gameId });
    }
});

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

window.breakCam = function(i) {
    socket.emit('breakCamera', { gameId, camIndex: i });
};

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
        dh += `D${i+1}:<span style="color:${d.closed?'var(--red)':'var(--green)'}"> ${d.closed?'CLOSED':'OPEN'}</span> `;
    });
    $('aDoors').innerHTML = dh;
    $('aSys').textContent = st.systemOff ? 'OFF ❌' : 'ON ✓';
    $('aSys').style.color = st.systemOff ? 'var(--red)' : 'var(--green)';
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

// ===== СОБЫТИЯ И ЗВУКИ =====

// НАЧАЛО ИГРЫ
socket.on('gameStarted', st => {
    play(snd.nightStart);
    updateUI(st);
});

socket.on('powerOut', st => {
    stop(snd.nightStart);
    play(snd.pwrOut);
    updateUI(st);
});

socket.on('rebootApproved', st => {
    play(snd.pwrOn);
    $('pReboot').style.display = 'none';
    updateUI(st);
});

// ПОБЕДА (охранник выжил)
socket.on('gameWon', () => {
    stop(snd.nightStart);
    play(snd.win);
    $('winEnd').classList.add('on');

    snd.win.onended = () => {
        play(snd.winMelody);
    };
});

// ПРОИГРЫШ (аниматроник поймал)
socket.on('gameLost', () => {
    stop(snd.nightStart);
    play(snd.scare);
    $('loseEnd').classList.add('on');
});

socket.on('gameState', updateUI);
socket.on('cameraBrokenNotify', d => updateUI(d.state));
socket.on('cameraRepairedNotify', d => updateUI(d.state));

socket.on('rebootWaitingApproval', st => {
    S = st;
    $('pReboot').style.display = 'block';
});

socket.on('rebootDenied', st => {
    $('pReboot').style.display = 'none';
    updateUI(st);
});

})();
