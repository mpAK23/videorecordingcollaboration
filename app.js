// App State Structure
const appState = {
    role: null,
    peer: null,
    dataConn: null,
    remoteStream: null,
    activeRecorder: null,
    recordingBoxId: null,
    audioCtx: null, 
    hostAudioDest: null,
    remoteModeEnabled: false,
    performerReady: false,
    tracks: [
        { id: 1, blob: null, url: null, hasData: false, audioNode: null },
        { id: 2, blob: null, url: null, hasData: false, audioNode: null },
        { id: 3, blob: null, url: null, hasData: false, audioNode: null },
        { id: 4, blob: null, url: null, hasData: false, audioNode: null }
    ]
};

// UI Elements
const els = {
    screens: {
        setup: document.getElementById('setup-screen'),
        camera: document.getElementById('camera-screen'),
        host: document.getElementById('host-screen')
    },
    setup: {
        createHost: document.getElementById('btn-create-host'),
        joinCamera: document.getElementById('btn-join-camera'),
        roomIdInput: document.getElementById('input-room-id')
    },
    camera: {
        roomDisplay: document.querySelector('#camera-room-display span'),
        status: document.getElementById('camera-status'),
        video: document.getElementById('local-camera-video'),
        readyContainer: document.getElementById('camera-ready-container'),
        btnReady: document.getElementById('btn-camera-ready'),
        audioPlayback: document.getElementById('remote-audio-playback')
    },
    host: {
        roomDisplay: document.querySelector('#host-room-display span'),
        status: document.getElementById('host-status'),
        exportBtn: document.getElementById('btn-export-mix'),
        exportName: document.getElementById('export-name'),
        canvas: document.getElementById('mix-canvas'),
        btnNewSession: document.getElementById('btn-new-session'),
        remoteModeCb: document.getElementById('remote-mode-cb'),
        readyStatus: document.getElementById('host-ready-status')
    }
};

// Initialize Application Events
function init() {
    els.setup.createHost.addEventListener('click', initHost);
    els.setup.joinCamera.addEventListener('click', initCamera);
    els.host.exportBtn.addEventListener('click', exportMix);
    
    // Host Panel Interactions
    els.host.btnNewSession.addEventListener('click', resetHostSession);
    els.host.remoteModeCb.addEventListener('change', (e) => {
        appState.remoteModeEnabled = e.target.checked;
        if (appState.remoteModeEnabled && !appState.performerReady) {
            els.host.readyStatus.classList.remove('hidden');
        } else if (!appState.remoteModeEnabled) {
            els.host.readyStatus.classList.add('hidden');
        }
        if (appState.dataConn) {
            appState.dataConn.send({ type: 'REMOTE_MODE', value: appState.remoteModeEnabled });
        }
    });
    
    // Camera Panel Interactions
    els.camera.btnReady.addEventListener('click', () => {
        appState.performerReady = true;
        els.camera.btnReady.innerText = "Waiting for Countdown...";
        els.camera.btnReady.disabled = true;
        if (appState.dataConn) {
            appState.dataConn.send({ type: 'SET_READY', value: true });
        }
    });
    
    // Bind track box events
    for (let i = 1; i <= 4; i++) {
        const box = document.getElementById(`box-${i}`);
        
        box.querySelector('.add-btn').addEventListener('click', () => prepareBoxForRemote(i));
        box.querySelector('.del-btn').addEventListener('click', () => deleteTrack(i));
        
        const recordBtn = box.querySelector('.record-btn');
        recordBtn.addEventListener('click', () => toggleRecord(i));
        
        const playBtn = box.querySelector('.play-btn');
        playBtn.addEventListener('click', () => playSingleTrack(i));
    }
}

function showScreen(screenId) {
    Object.values(els.screens).forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

// -------------------------------------------------------------
// HOST / CONTROL CENTER LOGIC
// -------------------------------------------------------------
function initHost() {
    appState.role = 'host';
    
    // Resume or init AudioContext on user interaction
    if (!appState.audioCtx) {
        appState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    appState.audioCtx.resume();
    
    if (!appState.hostAudioDest) {
        appState.hostAudioDest = appState.audioCtx.createMediaStreamDestination();
    }
    
    showScreen('host-screen');
    setupHostPeer();
}

function resetHostSession() {
    if (appState.peer) {
        appState.peer.destroy();
    }
    appState.remoteStream = null;
    appState.dataConn = null;
    appState.performerReady = false;
    
    els.host.readyStatus.className = 'status dot-red';
    els.host.readyStatus.innerText = 'Performer Not Ready';
    if (!appState.remoteModeEnabled) els.host.readyStatus.classList.add('hidden');
    
    els.host.status.className = 'status dot-yellow';
    els.host.status.innerText = 'Waiting for Camera...';
    
    // Clear out active un-recorded incoming UI 
    for (let i = 1; i <= 4; i++) {
        const box = document.getElementById(`box-${i}`);
        if (!appState.tracks[i-1].hasData) {
            box.classList.add('empty');
            box.querySelector('.track-video').srcObject = null;
        } else {
            // Keep existing recorded track untouched
        }
    }
    
    setupHostPeer();
}

function setupHostPeer() {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const letter = letters[Math.floor(Math.random() * 26)];
    const numbers = Math.floor(1000 + Math.random() * 9000).toString();
    const roomId = letter + numbers;
    els.host.roomDisplay.innerText = roomId;
    
    appState.peer = new Peer(roomId);
    
    appState.peer.on('open', id => {
        console.log('Host ready. ID:', id);
    });
    
    appState.peer.on('connection', conn => {
        appState.dataConn = conn;
        conn.on('data', data => {
            if (data.type === 'SET_READY') {
                appState.performerReady = data.value;
                if (appState.performerReady) {
                    els.host.readyStatus.className = 'status dot-green';
                    els.host.readyStatus.innerText = 'Performer Ready!';
                }
            }
        });
        conn.on('open', () => {
            conn.send({ type: 'REMOTE_MODE', value: appState.remoteModeEnabled });
        });
    });
    
    appState.peer.on('call', call => {
        // Answer incoming camera stream AND SEND AUDIO RETURN FEED
        call.answer(appState.hostAudioDest.stream); 
        
        call.on('stream', stream => {
            console.log('Received remote stream from camera');
            appState.remoteStream = stream;
            els.host.status.className = 'status dot-green';
            els.host.status.innerText = 'Camera Connected';
        });
    });
}

// -------------------------------------------------------------
// CAMERA LOGIC
// -------------------------------------------------------------
async function initCamera() {
    const rawId = els.setup.roomIdInput.value.trim();
    if (!rawId) return alert('Enter a Room ID');
    
    appState.role = 'camera';
    showScreen('camera-screen');
    
    const hostId = rawId.toUpperCase();
    els.camera.roomDisplay.innerText = hostId;
    
    appState.peer = new Peer();
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, 
            audio: { echoCancellation: true, noiseSuppression: true } 
        });
        
        els.camera.video.srcObject = stream;
        
        appState.peer.on('open', () => {
            const call = appState.peer.call(hostId, stream);
            call.on('stream', remoteAudioStream => {
                // Host audio feed received (Metronome + Monitor playback)
                els.camera.audioPlayback.srcObject = remoteAudioStream;
            });
            
            const conn = appState.peer.connect(hostId);
            appState.dataConn = conn;
            conn.on('data', data => {
                if (data.type === 'REMOTE_MODE') {
                    appState.remoteModeEnabled = data.value;
                    if (data.value) {
                         els.camera.readyContainer.classList.remove('hidden');
                         els.camera.btnReady.disabled = false;
                         els.camera.btnReady.innerText = "I'm Ready!";
                    } else {
                         els.camera.readyContainer.classList.add('hidden');
                    }
                }
            });
            
            els.camera.status.className = 'status dot-green';
            els.camera.status.innerText = 'Streaming to Host';
        });
        
    } catch (err) {
        console.error('Camera access failed:', err);
        alert('Failed to access camera. Check permissions/HTTPS.');
    }
}

// -------------------------------------------------------------
// RECORDING & PLAYBACK LOGIC
// -------------------------------------------------------------
function prepareBoxForRemote(id) {
    if (!appState.remoteStream) {
        return alert('Camera not connected yet!');
    }
    
    const box = document.getElementById(`box-${id}`);
    box.classList.remove('empty');
    
    const vid = box.querySelector('.track-video');
    vid.srcObject = appState.remoteStream;
    vid.play();
    vid.muted = true; // Mute live feed so host doesn't hear echo
}

function playClick() {
    if (!appState.audioCtx) return;
    const osc = appState.audioCtx.createOscillator();
    const gain = appState.audioCtx.createGain();
    osc.connect(gain);
    
    gain.connect(appState.audioCtx.destination); // Route to local speaker
    if (appState.hostAudioDest) {
        gain.connect(appState.hostAudioDest); // Route to Camera return feed
    }
    
    osc.frequency.setValueAtTime(800, appState.audioCtx.currentTime);
    gain.gain.setValueAtTime(0.5, appState.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, appState.audioCtx.currentTime + 0.1);
    
    osc.start();
    osc.stop(appState.audioCtx.currentTime + 0.1);
}

async function toggleRecord(id) {
    if (appState.activeRecorder) {
        // Stop recording
        appState.activeRecorder.stop();
        // Reset remote ready UI
        if (appState.remoteModeEnabled) {
            appState.performerReady = false;
            els.host.readyStatus.className = 'status dot-red';
            els.host.readyStatus.innerText = 'Performer Not Ready';
            if (appState.dataConn) {
                // Re-enable ready button on camera
                appState.dataConn.send({ type: 'REMOTE_MODE', value: true }); 
            }
        }
        return;
    }
    
    // Check if remote mode is enforced and we are waiting on them
    if (appState.remoteModeEnabled && !appState.performerReady) {
        return alert("Wait for the Performer to click 'I'm Ready' on their camera device.");
    }
    
    const box = document.getElementById(`box-${id}`);
    const vid = box.querySelector('.track-video');
    
    box.classList.add('counting');
    const ctEl = box.querySelector('.countdown-text');
    
    // Metronome 4 clicks 
    for(let i=4; i>0; i--) {
        ctEl.innerText = i;
        playClick();
        await new Promise(r => setTimeout(r, 1000));
    }
    
    box.classList.remove('counting');
    box.classList.add('recording');
    
    // Synchronized playback of monitored tracks
    for (let j=1; j<=4; j++) {
        if (j !== id && appState.tracks[j-1].hasData) {
            const otherBox = document.getElementById(`box-${j}`);
            if (otherBox.querySelector('.monitor-cb').checked) {
                const otherVid = otherBox.querySelector('.track-video');
                otherVid.currentTime = 0;
                otherVid.play();
            }
        }
    }
    
    // Ensure the focus is on the live stream during recording
    vid.srcObject = appState.remoteStream;
    vid.play();
    
    // Start MediaRecorder
    let mime = '';
    const types = [
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=h264',
        'video/webm'
    ];
    for (let t of types) {
        if (MediaRecorder.isTypeSupported(t)) { mime = t; break; }
    }
    
    const recorder = new MediaRecorder(appState.remoteStream, { mimeType: mime });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    
    recorder.onstop = () => {
        appState.activeRecorder = null;
        appState.recordingBoxId = null;
        box.classList.remove('recording');
        
        // Stop all monitors
        for (let j=1; j<=4; j++) {
            if (j !== id && appState.tracks[j-1].hasData) {
                document.getElementById(`box-${j}`).querySelector('.track-video').pause();
            }
        }
        
        const blob = new Blob(chunks, { type: mime });
        saveTrackData(id, blob);
    };
    
    recorder.start();
    appState.activeRecorder = recorder;
    appState.recordingBoxId = id;
}

function saveTrackData(id, blob) {
    const track = appState.tracks[id-1];
    track.blob = blob;
    track.hasData = true;
    
    if (track.url) URL.revokeObjectURL(track.url);
    track.url = URL.createObjectURL(blob);
    
    const box = document.getElementById(`box-${id}`);
    const vid = box.querySelector('.track-video');
    
    vid.srcObject = null;
    vid.src = track.url;
    vid.muted = false; // We want to hear the recorded audio when played back locally
    
    // Setup Audio Routing for Export Mix AND returning to Camera performer
    if (!track.audioNode && appState.audioCtx) {
        track.audioNode = appState.audioCtx.createMediaElementSource(vid);
        track.audioNode.connect(appState.audioCtx.destination); // Route back to host speakers
        if (appState.hostAudioDest) {
            track.audioNode.connect(appState.hostAudioDest); // Route back to remote Camera return feed
        }
    }
    
    box.querySelector('.record-btn').classList.add('hidden');
    box.querySelector('.play-btn').classList.remove('hidden');
}

function playSingleTrack(id) {
    const vid = document.getElementById(`box-${id}`).querySelector('.track-video');
    vid.currentTime = 0;
    vid.play();
}

function deleteTrack(id) {
    const track = appState.tracks[id-1];
    track.hasData = false;
    track.blob = null;
    if (track.url) URL.revokeObjectURL(track.url);
    
    const box = document.getElementById(`box-${id}`);
    box.classList.add('empty');
    
    const vid = box.querySelector('.track-video');
    vid.pause();
    vid.src = "";
    vid.srcObject = null;
    
    box.querySelector('.record-btn').classList.remove('hidden');
    box.querySelector('.play-btn').classList.add('hidden');
}

// -------------------------------------------------------------
// EXPORT & MIXING LOGIC (Canvas + WebAudio)
// -------------------------------------------------------------
async function exportMix() {
    const name = els.host.exportName.value.trim() || 'Mix';
    
    const tracksToExport = [];
    appState.tracks.forEach((t, idx) => {
        const _id = idx + 1;
        const box = document.getElementById(`box-${_id}`);
        if(t.hasData && box.querySelector('.export-cb').checked) {
            tracksToExport.push({ track: t, vidEl: box.querySelector('.track-video'), id: _id });
        }
    });
    
    if (tracksToExport.length === 0) return alert('No tracks selected to export!');
    
    appState.audioCtx.resume();
    
    const canvas = els.host.canvas;
    const ctx = canvas.getContext('2d');
    
    const dest = appState.audioCtx.createMediaStreamDestination();
    
    // Connect selected tracks to Mix Destination
    tracksToExport.forEach(t => {
        if(t.track.audioNode) {
            t.track.audioNode.disconnect();
            t.track.audioNode.connect(dest);
            t.track.audioNode.connect(appState.audioCtx.destination);
        }
    });
    
    const canvasStream = canvas.captureStream(30);
    // Mix the audio stream into the canvas stream
    dest.stream.getAudioTracks().forEach(track => canvasStream.addTrack(track));
    
    let mime = '';
    const types = [
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=h264',
        'video/webm'
    ];
    for (let t of types) {
        if (MediaRecorder.isTypeSupported(t)) { mime = t; break; }
    }
    const recorder = new MediaRecorder(canvasStream, { mimeType: mime });
    
    const chunks = [];
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = () => {
        // Reconnect audio nodes to normal flow
        tracksToExport.forEach(t => {
            if(t.track.audioNode) {
                t.track.audioNode.disconnect();
                t.track.audioNode.connect(appState.audioCtx.destination);
                if (appState.hostAudioDest) {
                    t.track.audioNode.connect(appState.hostAudioDest);
                }
            }
        });
        
        const blob = new Blob(chunks, { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const ext = mime.includes('mp4') ? 'mp4' : 'webm';
        a.download = `${name}_${tracksToExport.map(t=>t.id).join('_')}.${ext}`;
        a.click();
        
        els.host.exportBtn.innerText = 'Export Mix (.mp4/webm)';
        els.host.exportBtn.disabled = false;
    };
    
    els.host.exportBtn.innerText = 'Mixing... Please Wait';
    els.host.exportBtn.disabled = true;
    
    recorder.start();
    
    // Reset and play all videos
    tracksToExport.forEach(t => {
        t.vidEl.currentTime = 0;
        t.vidEl.play();
    });
    
    function drawVideoCover(vid, x, y, w, h) {
        const vidW = vid.videoWidth || 1280;
        const vidH = vid.videoHeight || 720;
        const vidRatio = vidW / vidH;
        const containerRatio = w / h;

        let sourceX = 0, sourceY = 0, sourceW = vidW, sourceH = vidH;

        if (vidRatio > containerRatio) {
            // Video is wider than the container, crop sides
            sourceW = vidH * containerRatio;
            sourceX = (vidW - sourceW) / 2;
        } else {
            // Video is taller than the container, crop top/bottom
            sourceH = vidW / containerRatio;
            sourceY = (vidH - sourceH) / 2;
        }

        ctx.drawImage(vid, sourceX, sourceY, sourceW, sourceH, x, y, w, h);
    }

    function drawFrame() {
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const count = tracksToExport.length;
        const w = canvas.width;
        const h = canvas.height;
        
        if (count === 1) {
            drawVideoCover(tracksToExport[0].vidEl, 0, 0, w, h);
        } else if (count === 2) {
            drawVideoCover(tracksToExport[0].vidEl, 0, 0, w/2, h);
            drawVideoCover(tracksToExport[1].vidEl, w/2, 0, w/2, h);
        } else if (count === 3) {
            drawVideoCover(tracksToExport[0].vidEl, 0, 0, w/3, h);
            drawVideoCover(tracksToExport[1].vidEl, w/3, 0, w/3, h);
            drawVideoCover(tracksToExport[2].vidEl, 2*w/3, 0, w/3, h);
        } else if (count === 4) {
            drawVideoCover(tracksToExport[0].vidEl, 0, 0, w/2, h/2);
            drawVideoCover(tracksToExport[1].vidEl, w/2, 0, w/2, h/2);
            drawVideoCover(tracksToExport[2].vidEl, 0, h/2, w/2, h/2);
            drawVideoCover(tracksToExport[3].vidEl, w/2, h/2, w/2, h/2); 
        }
        
        const stillPlaying = tracksToExport.some(t => !t.vidEl.paused && !t.vidEl.ended);
        
        if (stillPlaying) {
            requestAnimationFrame(drawFrame);
        } else {
            recorder.stop();
        }
    }
    
    drawFrame();
}

window.addEventListener('DOMContentLoaded', init);
