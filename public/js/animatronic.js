(function(){
const socket = io();
const params = new URLSearchParams(location.search);
const gameId = params.get('game');

if (!gameId) { document.body.innerHTML = '<div style="color:red;padding:40px;font-family:monospace;">No game ID</div>'; return; }

let S = null; let connected = false; const $ = id => document.getElementById(id);

function au(src, loop, vol) {
    const a = new Audio(); a.loop = !!loop; a.volume = vol !== undefined ? vol : 0.4;
    a.src = src; return a;
}

const snd = {
    nightStart: au('https://files.catbox.moe/8y8z75.mp3', false, 0.5),
    winMelody:  au('https://files.catbox.moe/esjta4.ogg', false, 0.5),
    pwrOut:     au('https://files.catbox.moe/hvxd67.mp3', false, 0.6),
    pwrOn:      au('https://files.catbox.moe/zuy3mk.mp3', false, 0.6),
    scare:      au('https://files.catbox.moe/bfucts.mp3', false, 0.9),
    win:        au('https://files.catbox.moe/zuy3mk.mp3', false, 0.7)
};

function play(a) { if (!a) return; try { a.currentTime = 0; const p = a.play(); if (p && p.catch) p.catch(()=>{}); } catch(e) {} }
function stop(a) { if (!a) return; try { a.pause(); a.currentTime = 0; } catch(e) {} }

const btnConn = $('btnConnect');
if (btnConn) {
    btnConn.addEventListener('click', () => {
        const name = ($('animName') ? $('animName').value : '') || 'Freddy';
        if ($('connectMsg')) $('connectMsg').textContent = 'Connecting...';
        socket.emit('joinAsAnimatronic', { gameId, name }, res => {
            if (!res || !res.success) { if ($('connectMsg')) $('connectMsg').textContent = 'Error: ' + (res ? res.error : ''); return; }
            connected = true;
            if ($('pConnect')) $('pConnect').style.display = 'none';
            if ($('pStatus')) $('pStatus').style.display = 'block';
            if ($('pSabotage')) $('pSabotage').style.display = 'block';
            if ($('pAttack')) $('pAttack').style.display = 'block';
        });
    });
}

const btnKP = $('btnKillPwr');
if (btnKP) { btnKP.addEventListener('click', () => { socket.emit('killPower', { gameId }); }); }

const btnSc = $('btnScare');
if (btnSc) { btnSc.addEventListener('click', () => { if (confirm('Trigger jumpscare?')) socket.emit('jumpscare', { gameId }); }); }

const btnApp = $('btnApprove');
if (btnApp) { btnApp.addEventListener('click', () => { socket.emit('approveReboot', { gameId }); if ($('pReboot')) $('pReboot').style.display = 'none'; }); }

const btnDn = $('btnDeny');
if (btnDn) { btnDn.addEventListener('click', () => { socket.emit('denyReboot', { gameId }); if ($('pReboot')) $('pReboot').style.display = 'none'; }); }

window.breakCam = function (i) {
    socket.emit('breakCamera', { gameId, camIndex: i });
    const btn = document.getElementById('breakCamBtn' + i);
    if (btn) {
        btn.disabled = true; let cd = 30; btn.textContent = `COOLDOWN (${cd}s)`;
        const int = setInterval(() => { cd--; btn.textContent = `COOLDOWN (${cd}s)`; if (cd <= 0) { clearInterval(int); btn.disabled = false; btn.textContent = `📷 BREAK CAM ${i+1}`; } }, 1000);
    }
};

function updateUI(st) {
    if (!st || !connected) return; S = st;
    if ($('aTime')) $('aTime').textContent = st.hourString;
    const p = Math.round(st.power);
    if ($('aPwr')) { $('aPwr').textContent = p + '%'; $('aPwr').style.color = p <= 15 ? 'var(--red)' : p <= 40 ? 'var(--yellow)' : 'var(--green)'; }
    if ($('aCams')) { $('aCams').textContent = st.camerasUp ? 'UP 👁️' : 'DOWN'; $('aCams').style.color = st.camerasUp ? 'var(--green)' : 'var(--red)'; }
    let dh = 'Doors: ';
    if (st.doors) { st.doors.forEach((d, i) => { dh += `D${i+1}:<span style="color:${d.closed?'var(--red)':'var(--green)'}"> ${d.closed?'CLOSED':'OPEN'}</span> `; }); }
    if ($('aDoors')) $('aDoors').innerHTML = dh;
    if ($('aSys')) { $('aSys').textContent = st.systemOff ? 'OFF ❌' : 'ON ✓'; $('aSys').style.color = st.systemOff ? 'var(--red)' : 'var(--green)'; }

    const killBtn = $('btnKillPwr');
    if (killBtn) {
        if (st.systemOff) { killBtn.disabled = true; killBtn.textContent = '⚡ POWER IS OFF'; }
        else { killBtn.disabled = false; killBtn.textContent = '⚡ KILL POWER'; }
    }

    if (!$('camActions').innerHTML) {
        let ch = '';
        if (st.cameras) { st.cameras.forEach((cam, i) => { if (!cam.connected) return; ch += `<button class="anim-btn" id="breakCamBtn${i}" onclick="breakCam(${i})">📷 BREAK CAM ${i+1}</button>`; }); }
        if ($('camActions')) $('camActions').innerHTML = ch;
    }
}

socket.on('gameStarted', st => { play(snd.nightStart); updateUI(st); });
socket.on('powerOut', st => { stop(snd.nightStart); play(snd.pwrOut); updateUI(st); });
socket.on('rebootApproved', st => { play(snd.pwrOn); if ($('pReboot')) $('pReboot').style.display = 'none'; updateUI(st); });
socket.on('gameWon', () => { stop(snd.nightStart); play(snd.win); if ($('winEnd')) $('winEnd').classList.add('on'); snd.win.onended = () => { play(snd.winMelody); }; });
socket.on('gameLost', () => { stop(snd.nightStart); play(snd.scare); if ($('loseEnd')) $('loseEnd').classList.add('on'); });
socket.on('gameState', updateUI);
socket.on('cameraBrokenNotify', d => updateUI(d.state));
socket.on('cameraRepairedNotify', d => updateUI(d.state));

socket.on('rebootWaitingApproval', st => {
    S = st;
    const pReboot = $('pReboot');
    if (pReboot) {
        pReboot.style.display = 'block';
        setTimeout(() => { pReboot.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, 100);
    }
});

socket.on('rebootDenied', st => { if ($('pReboot')) $('pReboot').style.display = 'none'; updateUI(st); });
})();
