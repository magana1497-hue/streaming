(function () {
    'use strict';

    const wsConfig = document.getElementById('ws-config');
    const wsPath   = wsConfig ? wsConfig.dataset.wsUrl : '/streaming/ws/signal';
    const wsProto  = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    let ws         = null;
    let pc         = null;
    let currentHls = null;
    let liveOfferTimer = null; // timeout if offer never arrives

    const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

    // ── UI refs ───────────────────────────────────────────────────────────────
    const player        = document.getElementById('player');
    const waitingScreen = document.getElementById('waiting-screen');
    const tapOverlay    = document.getElementById('tap-overlay');
    const liveBadge     = document.getElementById('live-badge');
    const statusText    = document.getElementById('status-text');
    const statusIcon    = document.getElementById('status-icon');
    const btnFullscreen = document.getElementById('btn-fullscreen');

    // ── Tap-to-play ───────────────────────────────────────────────────────────
    function showTapOverlay() {
        console.log('[Viewer] showing tap-to-play overlay');
        if (tapOverlay) tapOverlay.style.display = 'flex';
    }

    function hideTapOverlay() {
        if (tapOverlay) tapOverlay.style.display = 'none';
    }

    if (tapOverlay) {
        tapOverlay.addEventListener('click', function () {
            console.log('[Viewer] tap-to-play clicked');
            hideTapOverlay();
            tryFullscreen(); // user gesture — fullscreen allowed here
            if (player) {
                player.muted = false;
                player.volume = 1;
                player.play().catch(function (e) {
                    console.warn('[Viewer] play after tap failed:', e.message);
                    player.muted = true;
                    player.play().catch(function () {});
                });
            }
        });
    }

    // Waiting screen click = attempt fullscreen immediately
    if (waitingScreen) {
        waitingScreen.addEventListener('click', function () {
            console.log('[Viewer] waiting screen tapped — requesting fullscreen');
            tryFullscreen();
        });
    }

    // ── Play helper ───────────────────────────────────────────────────────────
    function attemptPlay() {
        if (!player) return;
        // Try unmuted first
        player.muted = false;
        player.volume = 1;
        player.play()
            .then(function () {
                console.log('[Viewer] play succeeded (unmuted)');
                hideTapOverlay();
                tryFullscreen();
            })
            .catch(function () {
                console.warn('[Viewer] unmuted play blocked — retrying muted');
                // Retry muted (autoplay policy)
                player.muted = true;
                player.play()
                    .then(function () {
                        console.log('[Viewer] play succeeded (muted) — showing tap overlay for unmute');
                        tryFullscreen();
                        showTapOverlay();
                    })
                    .catch(function (e) {
                        console.error('[Viewer] play failed even muted:', e.message);
                        showTapOverlay();
                    });
            });
    }

    // ── Fullscreen ────────────────────────────────────────────────────────────
    function isFullscreen() {
        return !!(document.fullscreenElement || document.webkitFullscreenElement
               || document.mozFullScreenElement || document.msFullscreenElement);
    }

    function tryFullscreen() {
        if (isFullscreen()) return;
        var el = document.documentElement;
        var fn = el.requestFullscreen || el.webkitRequestFullscreen
               || el.mozRequestFullScreen || el.msRequestFullscreen;
        if (fn) {
            fn.call(el).then(function () {
                console.log('[Viewer] fullscreen entered');
                updateFullscreenBtn();
            }).catch(function (e) {
                console.warn('[Viewer] fullscreen blocked (needs user gesture):', e.message);
                updateFullscreenBtn();
            });
        }
    }

    function exitFullscreen() {
        var fn = document.exitFullscreen || document.webkitExitFullscreen
               || document.mozCancelFullScreen || document.msExitFullscreen;
        if (fn) fn.call(document).catch(function () {});
    }

    function updateFullscreenBtn() {
        if (!btnFullscreen) return;
        if (isFullscreen()) {
            btnFullscreen.textContent = '✕';
            btnFullscreen.title = 'Salir de pantalla completa';
        } else {
            btnFullscreen.textContent = '⛶';
            btnFullscreen.title = 'Pantalla completa';
        }
    }

    // Show/hide fullscreen button only when player is visible
    function showFullscreenBtn(visible) {
        if (btnFullscreen) btnFullscreen.style.display = visible ? 'block' : 'none';
    }

    if (btnFullscreen) {
        btnFullscreen.addEventListener('click', function () {
            if (isFullscreen()) exitFullscreen();
            else tryFullscreen();
        });
    }

    // Sync button state when OS/browser exits fullscreen (Esc key etc.)
    document.addEventListener('fullscreenchange', updateFullscreenBtn);
    document.addEventListener('webkitfullscreenchange', updateFullscreenBtn);
    document.addEventListener('mozfullscreenchange', updateFullscreenBtn);
    document.addEventListener('MSFullscreenChange', updateFullscreenBtn);

    // ── WebSocket ─────────────────────────────────────────────────────────────
    function connect() {
        var url = wsProto + '//' + window.location.host + wsPath + '?role=viewer';
        console.log('[WS] connecting to', url);
        ws = new WebSocket(url);

        ws.onopen = function () {
            console.log('[WS] connected');
            setWaiting('Conectado. Esperando transmisión…', '📡');
        };

        ws.onmessage = function (evt) {
            try {
                var msg = JSON.parse(evt.data);
                console.log('[WS] ←', msg.type, msg);
                handleMsg(msg);
            } catch (e) {
                console.error('[WS] parse error', e);
            }
        };

        ws.onclose = function (evt) {
            console.warn('[WS] closed — code:', evt.code, 'reason:', evt.reason || '(none)');
            setWaiting('Conexión perdida. Reconectando…', '🔄');
            clearLiveOfferTimer();
            closePeer();
            setTimeout(connect, 3000);
        };

        ws.onerror = function (err) {
            console.error('[WS] error', err);
            ws.close();
        };
    }

    function send(obj) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            console.log('[WS] →', obj.type, obj);
            ws.send(JSON.stringify(obj));
        } else {
            console.warn('[WS] send skipped — not open', obj);
        }
    }

    // ── Message handling ──────────────────────────────────────────────────────
    function handleMsg(msg) {
        switch (msg.type) {
            case 'mode':
                handleMode(msg);
                break;
            case 'offer':
                clearLiveOfferTimer();
                handleOffer(msg.offer);
                break;
            case 'ice':
                addIce(msg.candidate);
                break;
            case 'stop':
                console.log('[Viewer] stop received — clearing stream');
                clearLiveOfferTimer();
                closePeer();
                destroyHls();
                hideTapOverlay();
                setWaiting('Transmisión finalizada.', '⏹️');
                showLiveBadge(false);
                break;
            default:
                console.warn('[WS] unknown message type:', msg.type);
        }
    }

    function handleMode(msg) {
        console.log('[Viewer] mode:', msg.mode, msg.src || '');
        clearLiveOfferTimer();

        if (msg.mode === 'url') {
            closePeer();
            destroyHls();
            showLiveBadge(false);
            hideTapOverlay();
            setWaiting('Cargando video…', '⏳');
            loadVideo(msg.src);

        } else if (msg.mode === 'live') {
            closePeer();
            destroyHls();
            hideTapOverlay();
            showLiveBadge(true);
            setWaiting('Conectando transmisión en vivo…', '📡');
            // If offer doesn't arrive in 20s, show helpful message
            liveOfferTimer = setTimeout(function () {
                console.warn('[Viewer] offer timeout — no WebRTC offer received in 20s');
                setWaiting('Esperando al administrador para iniciar la transmisión…', '⏳');
            }, 20000);

        } else if (msg.mode === 'off') {
            closePeer();
            destroyHls();
            hideTapOverlay();
            showLiveBadge(false);
            setWaiting('Sin transmisión activa.', '📡');
        }
    }

    function clearLiveOfferTimer() {
        if (liveOfferTimer) {
            clearTimeout(liveOfferTimer);
            liveOfferTimer = null;
        }
    }

    // ── WebRTC ────────────────────────────────────────────────────────────────
    function handleOffer(offer) {
        console.log('[WebRTC] offer received — creating peer connection');
        closePeer();
        pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

        pc.onicecandidate = function (evt) {
            if (evt.candidate) {
                console.log('[WebRTC] ICE candidate', evt.candidate.type);
                send({ type: 'ice', candidate: evt.candidate });
            } else {
                console.log('[WebRTC] ICE gathering complete');
            }
        };

        pc.oniceconnectionstatechange = function () {
            console.log('[WebRTC] ICE state:', pc.iceConnectionState);
            if (pc.iceConnectionState === 'failed') {
                console.error('[WebRTC] ICE failed — P2P connection could not be established');
                setWaiting('Error de conexión P2P. El administrador puede estar en una red diferente.', '⚠️');
            } else if (pc.iceConnectionState === 'disconnected') {
                console.warn('[WebRTC] ICE disconnected — may recover');
                setWaiting('Conexión inestable, intentando recuperar…', '🔄');
            }
        };

        pc.onconnectionstatechange = function () {
            console.log('[WebRTC] connection state:', pc.connectionState);
        };

        pc.ontrack = function (evt) {
            var stream = evt.streams[0];
            console.log('[WebRTC] track received — kind:', evt.track.kind, 'streams:', evt.streams.length);
            if (player.srcObject !== stream) {
                player.srcObject = stream;
                showPlayer();
                attemptPlay();
            }
        };

        pc.setRemoteDescription(new RTCSessionDescription(offer))
            .then(function () {
                console.log('[WebRTC] remote description set — creating answer');
                return pc.createAnswer();
            })
            .then(function (ans) {
                console.log('[WebRTC] answer created — setting local description');
                return pc.setLocalDescription(ans);
            })
            .then(function () {
                console.log('[WebRTC] sending answer');
                send({ type: 'answer', answer: pc.localDescription });
            })
            .catch(function (err) {
                console.error('[WebRTC] handleOffer error:', err);
                setWaiting('Error al establecer conexión WebRTC: ' + err.message, '⚠️');
            });
    }

    function addIce(candidate) {
        if (pc && candidate) {
            pc.addIceCandidate(new RTCIceCandidate(candidate))
                .catch(function (err) { console.error('[WebRTC] addIce error:', err); });
        }
    }

    function closePeer() {
        if (pc) {
            console.log('[WebRTC] closing peer connection');
            pc.close();
            pc = null;
        }
        if (player) {
            player.srcObject = null;
        }
    }

    // ── HLS / Video loader ────────────────────────────────────────────────────
    function loadVideo(src) {
        console.log('[Video] loadVideo —', src);
        destroyHls();

        var isHls = src.indexOf('.m3u8') !== -1 || src.indexOf('/stream/') !== -1;
        console.log('[Video] type:', isHls ? 'HLS' : 'direct', '— src:', src);

        if (isHls) {
            if (window.Hls && Hls.isSupported()) {
                console.log('[Video] using HLS.js');
                currentHls = new Hls({
                    enableWorker: true,
                    lowLatencyMode: false,
                    maxBufferLength: 10,
                    maxMaxBufferLength: 20,
                    maxBufferSize: 20 * 1000 * 1000
                });
                currentHls.loadSource(src);
                currentHls.attachMedia(player);

                currentHls.on(Hls.Events.MANIFEST_PARSED, function (evt, data) {
                    console.log('[Video] HLS manifest parsed — levels:', data.levels.length);
                    showPlayer();
                    attemptPlay();
                });

                currentHls.on(Hls.Events.LEVEL_LOADED, function (evt, data) {
                    console.log('[Video] HLS level loaded — fragments:', data.details.fragments.length);
                });

                currentHls.on(Hls.Events.ERROR, function (event, data) {
                    console.error('[Video] HLS error — details:', data.details, 'fatal:', data.fatal, 'url:', data.url || (data.context && data.context.url));
                    if (data.fatal) {
                        destroyHls();
                        var msg = 'Error de reproducción';
                        if (data.details === 'manifestLoadError') {
                            msg = 'No se pudo cargar el video (error ' + (data.response && data.response.code ? data.response.code : '') + ')';
                        } else if (data.details === 'manifestLoadTimeOut') {
                            msg = 'Tiempo de espera agotado al cargar el video';
                        } else if (data.details === 'networkError') {
                            msg = 'Error de red al reproducir el video';
                        }
                        setWaiting(msg, '⚠️');
                    }
                });

            } else if (player.canPlayType('application/vnd.apple.mpegurl')) {
                console.log('[Video] using native HLS (Safari)');
                player.src = src;
                player.addEventListener('loadedmetadata', function onMeta() {
                    player.removeEventListener('loadedmetadata', onMeta);
                    console.log('[Video] native HLS metadata loaded');
                    showPlayer();
                    attemptPlay();
                });
                player.addEventListener('error', function onErr() {
                    player.removeEventListener('error', onErr);
                    console.error('[Video] native HLS error:', player.error);
                    setWaiting('Error de reproducción en Safari.', '⚠️');
                });
            } else {
                console.error('[Video] HLS not supported in this browser');
                setWaiting('Tu navegador no soporta HLS. Usa Chrome, Edge o Safari.', '⚠️');
            }

        } else {
            // mp4 / webm / enlace directo
            console.log('[Video] direct video — setting src');
            player.srcObject = null;
            player.src = src;
            player.load();
            player.addEventListener('canplay', function onCan() {
                player.removeEventListener('canplay', onCan);
                console.log('[Video] canplay fired');
                showPlayer();
                attemptPlay();
            });
            player.addEventListener('error', function onErr() {
                player.removeEventListener('error', onErr);
                console.error('[Video] direct video error:', player.error);
                setWaiting('Error al cargar el video.', '⚠️');
            });
        }
    }

    function destroyHls() {
        if (currentHls) {
            console.log('[Video] destroying HLS instance');
            currentHls.destroy();
            currentHls = null;
        }
        if (player) {
            player.srcObject = null;
            player.src = '';
        }
    }

    // ── UI helpers ────────────────────────────────────────────────────────────
    function showPlayer() {
        if (waitingScreen) waitingScreen.style.display = 'none';
        if (player)        player.style.display        = 'block';
        showFullscreenBtn(true);
        tryFullscreen();
        console.log('[Viewer] player shown');
    }

    function setWaiting(text, icon) {
        console.log('[Viewer] waiting —', icon, text);
        destroyHls();
        closePeer();
        hideTapOverlay();
        showFullscreenBtn(false);
        if (player) player.style.display = 'none';
        if (waitingScreen) waitingScreen.style.display = 'flex';
        if (statusText)    statusText.textContent      = text || 'Esperando…';
        if (statusIcon)    statusIcon.textContent      = icon || '📡';
    }

    function showLiveBadge(show) {
        if (liveBadge) liveBadge.style.display = show ? 'inline-block' : 'none';
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    console.log('[Viewer] init — wsPath:', wsPath);
    connect();
})();
