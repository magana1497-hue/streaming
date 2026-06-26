(function () {
    'use strict';

    const wsConfig = document.getElementById('ws-config');
    const wsPath   = wsConfig ? wsConfig.dataset.wsUrl : '/streaming/ws/signal';
    const wsProto  = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    let ws         = null;
    let pc         = null;
    let currentHls = null; // HLS.js instance

    const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

    // ── UI refs ───────────────────────────────────────────────────────────────
    const player        = document.getElementById('player');
    const waitingScreen = document.getElementById('waiting-screen');
    const liveBadge     = document.getElementById('live-badge');
    const statusText    = document.getElementById('status-text');
    const statusIcon    = document.getElementById('status-icon');

    function tryUnmute() {
        player.muted = false;
        player.volume = 1;
    }

    function tryFullscreen() {
        var el = document.documentElement;
        var fn = el.requestFullscreen
            || el.webkitRequestFullscreen
            || el.mozRequestFullScreen
            || el.msRequestFullscreen;
        if (fn) fn.call(el).catch(function () {});
    }

    // ── WebSocket ─────────────────────────────────────────────────────────────
    function connect() {
        ws = new WebSocket(wsProto + '//' + window.location.host + wsPath + '?role=viewer');

        ws.onopen = function () {
            setWaiting('Conectado. Esperando transmisión…', '📡');
        };

        ws.onmessage = function (evt) {
            try { handleMsg(JSON.parse(evt.data)); }
            catch (e) { console.error('WS parse error', e); }
        };

        ws.onclose = function () {
            setWaiting('Conexión perdida. Reconectando…', '🔄');
            closePeer();
            setTimeout(connect, 3000);
        };

        ws.onerror = function () { ws.close(); };
    }

    function send(obj) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(obj));
        }
    }

    // ── Message handling ──────────────────────────────────────────────────────
    function handleMsg(msg) {
        switch (msg.type) {
            case 'mode':  handleMode(msg);          break;
            case 'offer': handleOffer(msg.offer);   break;
            case 'ice':   addIce(msg.candidate);    break;
            case 'stop':
                setWaiting('Transmisión finalizada.', '⏹️');
                closePeer();
                destroyHls();
                break;
        }
    }

    function handleMode(msg) {
        if (msg.mode === 'url') {
            closePeer();
            showLiveBadge(false);
            loadVideo(msg.src);
            showPlayer();

        } else if (msg.mode === 'live') {
            // Offer will arrive shortly
            setWaiting('Conectando transmisión en vivo…', '📡');
            showLiveBadge(true);

        } else if (msg.mode === 'off') {
            setWaiting('Sin transmisión activa.', '📡');
            closePeer();
            showLiveBadge(false);
        }
    }

    // ── WebRTC ────────────────────────────────────────────────────────────────
    function handleOffer(offer) {
        closePeer();
        pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

        pc.onicecandidate = function (evt) {
            if (evt.candidate) {
                send({ type: 'ice', candidate: evt.candidate });
            }
        };

        pc.ontrack = function (evt) {
            var stream = evt.streams[0];
            if (player.srcObject !== stream) {
                player.srcObject = stream;
                player.muted = true;
                player.play()
                    .then(function () {
                        showPlayer();
                        showLiveBadge(true);
                        tryUnmute();
                        tryFullscreen();
                    })
                    .catch(function () {
                        showPlayer();
                        showLiveBadge(true);
                    });
            }
        };

        pc.setRemoteDescription(new RTCSessionDescription(offer))
            .then(function () { return pc.createAnswer(); })
            .then(function (ans) { return pc.setLocalDescription(ans); })
            .then(function () {
                send({ type: 'answer', answer: pc.localDescription });
            })
            .catch(function (err) { console.error('handleOffer', err); });
    }

    function addIce(candidate) {
        if (pc && candidate) {
            pc.addIceCandidate(new RTCIceCandidate(candidate))
                .catch(function (err) { console.error('addIce', err); });
        }
    }

    function closePeer() {
        if (pc) { pc.close(); pc = null; }
    }

    // ── HLS / Video loader ────────────────────────────────────────────────────

    function loadVideo(src) {
        destroyHls();
        var isHls = src.indexOf('.m3u8') !== -1 || src.indexOf('/stream/') !== -1;

        if (isHls) {
            if (window.Hls && Hls.isSupported()) {
                currentHls = new Hls({ enableWorker: true, lowLatencyMode: false });
                currentHls.loadSource(src);
                currentHls.attachMedia(player);
                currentHls.on(Hls.Events.MANIFEST_PARSED, function () {
                    player.muted = true;
                    player.play()
                        .then(function () {
                            showPlayer();
                            tryUnmute();
                            tryFullscreen();
                        })
                        .catch(function () {});
                });
                currentHls.on(Hls.Events.ERROR, function (event, data) {
                    if (data.fatal) {
                        console.error('HLS fatal error', data);
                        setWaiting('Error de reproducción HLS.', '⚠️');
                    }
                });
            } else if (player.canPlayType('application/vnd.apple.mpegurl')) {
                // Safari con soporte HLS nativo
                player.src = src;
                player.play().catch(function () {});
            } else {
                setWaiting('Formato HLS no soportado en este navegador.', '⚠️');
            }
        } else {
            // mp4 / webm / enlace directo
            player.srcObject = null;
            player.src = src;
            player.muted = false;
            player.load();
            player.play().catch(function () {});
        }
    }

    function destroyHls() {
        if (currentHls) {
            currentHls.destroy();
            currentHls = null;
        }
        player.srcObject = null;
        player.src = '';
    }

    // ── UI helpers ────────────────────────────────────────────────────────────
    function showPlayer() {
        if (waitingScreen) waitingScreen.style.display = 'none';
        if (player)        player.style.display        = 'block';
    }

    function setWaiting(text, icon) {
        if (player) {
            player.style.display = 'none';
            player.srcObject     = null;
            player.src           = '';
        }
        if (waitingScreen) waitingScreen.style.display = 'flex';
        if (statusText)    statusText.textContent      = text || 'Esperando…';
        if (statusIcon)    statusIcon.textContent      = icon || '📡';
    }

    function showLiveBadge(show) {
        if (liveBadge) liveBadge.style.display = show ? 'inline-block' : 'none';
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    tryFullscreen();
    connect();
})();
