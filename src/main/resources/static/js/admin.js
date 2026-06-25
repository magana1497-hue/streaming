(function () {
    'use strict';

    const wsConfig  = document.getElementById('ws-config');
    const ctxConfig = document.getElementById('ctx-config');
    const wsPath    = wsConfig  ? wsConfig.dataset.wsUrl   : '/streaming/ws/signal';
    const viewerUrl = ctxConfig ? ctxConfig.dataset.viewerUrl : '/streaming/ver';

    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    let ws           = null;
    let localStream  = null;
    const peers      = {}; // viewerId -> RTCPeerConnection

    const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

    // ── UI refs ──────────────────────────────────────────────────────────────
    const statusBadge      = document.getElementById('status-badge');
    const viewerCountNum   = document.getElementById('viewer-count-num');
    const btnUrl           = document.getElementById('btn-url');
    const btnLive          = document.getElementById('btn-live');
    const btnStop          = document.getElementById('btn-stop');
    const videoUrlInput    = document.getElementById('video-url');
    const adminPreview     = document.getElementById('admin-preview');
    const previewPH        = document.getElementById('preview-placeholder');
    const liveBadgePreview = document.getElementById('live-badge-preview');
    const viewerLinkInput  = document.getElementById('viewer-link');
    const btnCopyLink      = document.getElementById('btn-copy-link');

    // Set viewer URL
    if (viewerLinkInput) {
        viewerLinkInput.value = window.location.origin + viewerUrl;
    }

    if (btnCopyLink) {
        btnCopyLink.addEventListener('click', function () {
            navigator.clipboard.writeText(viewerLinkInput.value).then(function () {
                btnCopyLink.innerHTML = '<i class="mdi mdi-check"></i>';
                setTimeout(function () {
                    btnCopyLink.innerHTML = '<i class="mdi mdi-content-copy"></i>';
                }, 2000);
            });
        });
    }

    // ── WebSocket ─────────────────────────────────────────────────────────────
    function connect() {
        ws = new WebSocket(wsProto + '//' + window.location.host + wsPath + '?role=admin');

        ws.onopen = function () {
            setStatus('CONECTADO', 'success', 'mdi-circle');
            enableControls(true);
        };

        ws.onmessage = function (evt) {
            try { handleMsg(JSON.parse(evt.data)); }
            catch (e) { console.error('WS parse error', e); }
        };

        ws.onclose = function () {
            setStatus('DESCONECTADO', 'secondary', 'mdi-circle-outline');
            enableControls(false);
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
            case 'init':
                updateViewerCount(msg.viewerCount);
                break;
            case 'viewer-joined':
                updateViewerCount(msg.viewerCount);
                if (localStream) createOffer(msg.viewerId);
                break;
            case 'viewer-left':
                updateViewerCount(msg.viewerCount);
                closePeer(msg.viewerId);
                break;
            case 'answer':
                applyAnswer(msg.from, msg.answer);
                break;
            case 'ice':
                addIce(msg.from, msg.candidate);
                break;
        }
    }

    // ── WebRTC ────────────────────────────────────────────────────────────────
    function createOffer(viewerId) {
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        peers[viewerId] = pc;

        localStream.getTracks().forEach(function (track) {
            pc.addTrack(track, localStream);
        });

        pc.onicecandidate = function (evt) {
            if (evt.candidate) {
                send({ type: 'ice', target: viewerId, candidate: evt.candidate });
            }
        };

        // On LAN, push bitrate ceiling high once ICE is established
        pc.oniceconnectionstatechange = function () {
            if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
                pc.getSenders().forEach(function (sender) {
                    if (!sender.track) return;
                    var params = sender.getParameters();
                    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
                    if (sender.track.kind === 'video') {
                        params.encodings[0].maxBitrate           = 15 * 1024 * 1024; // 15 Mbps
                        params.encodings[0].degradationPreference = 'maintain-resolution';
                    } else {
                        params.encodings[0].maxBitrate = 256 * 1024; // 256 kbps audio
                    }
                    sender.setParameters(params).catch(function (e) { console.warn('setParameters', e); });
                });
            }
        };

        pc.createOffer()
            .then(function (offer) { return pc.setLocalDescription(offer); })
            .then(function () {
                send({ type: 'offer', target: viewerId, offer: pc.localDescription });
            })
            .catch(function (err) { console.error('createOffer', err); });
    }

    function applyAnswer(viewerId, answer) {
        const pc = peers[viewerId];
        if (pc) {
            pc.setRemoteDescription(new RTCSessionDescription(answer))
                .catch(function (err) { console.error('setRemoteDesc', err); });
        }
    }

    function addIce(viewerId, candidate) {
        const pc = peers[viewerId];
        if (pc && candidate) {
            pc.addIceCandidate(new RTCIceCandidate(candidate))
                .catch(function (err) { console.error('addIce', err); });
        }
    }

    function closePeer(viewerId) {
        if (peers[viewerId]) {
            peers[viewerId].close();
            delete peers[viewerId];
        }
    }

    function closeAllPeers() {
        Object.keys(peers).forEach(closePeer);
    }

    // ── Button handlers ───────────────────────────────────────────────────────
    if (btnUrl) {
        btnUrl.addEventListener('click', function () {
            var url = videoUrlInput.value.trim();
            if (!url) { alert('Ingrese una URL de video válida.'); return; }
            stopLiveStream();
            send({ type: 'mode', mode: 'url', src: url });
            setStatus('ENLACE ACTIVO', 'primary', 'mdi-link-variant');
            showLiveBadge(false);
            btnStop.disabled = false;
            btnUrl.disabled  = true;
            btnLive.disabled = true;
        });
    }

    if (btnLive) {
        btnLive.addEventListener('click', function () {
            navigator.mediaDevices.getDisplayMedia({
                    video: {
                        frameRate: { ideal: 30, max: 60 },
                        width:     { ideal: window.screen.width  },
                        height:    { ideal: window.screen.height }
                    },
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl:  false
                    }
                })
                .then(function (stream) {
                    // Tell the encoder to prefer sharpness over smoothness (screen content mode)
                    var vt = stream.getVideoTracks()[0];
                    if (vt) vt.contentHint = 'detail';
                    localStream = stream;
                    showPreview(stream);
                    send({ type: 'mode', mode: 'live' });
                    setStatus('EN VIVO', 'danger', 'mdi-broadcast');
                    showLiveBadge(true);
                    btnStop.disabled = false;
                    btnUrl.disabled  = true;
                    btnLive.disabled = true;

                    // When user clicks browser's native stop-sharing button
                    var videoTrack = stream.getVideoTracks()[0];
                    if (videoTrack) {
                        videoTrack.onended = function () { btnStop.click(); };
                    }
                })
                .catch(function (err) {
                    if (err.name !== 'NotAllowedError') {
                        console.error('getDisplayMedia', err);
                        alert('Error al capturar pantalla: ' + err.message);
                    }
                });
        });
    }

    if (btnStop) {
        btnStop.addEventListener('click', function () {
            stopLiveStream();
            send({ type: 'mode', mode: 'off' });
            setStatus('CONECTADO', 'success', 'mdi-circle');
            showLiveBadge(false);
            btnStop.disabled = true;
            enableControls(true);
            videoUrlInput.value = '';
        });
    }

    function stopLiveStream() {
        if (localStream) {
            localStream.getTracks().forEach(function (t) { t.stop(); });
            localStream = null;
        }
        closeAllPeers();
        hidePreview();
    }

    // ── UI helpers ────────────────────────────────────────────────────────────
    function setStatus(text, color, icon) {
        if (!statusBadge) return;
        statusBadge.className = 'badge bg-' + color + ' px-3 py-2 fs-6';
        statusBadge.innerHTML = '<i class="mdi ' + (icon || 'mdi-circle') + ' me-1"></i>' + text;
    }

    function updateViewerCount(n) {
        if (viewerCountNum) viewerCountNum.textContent = n;
    }

    function enableControls(enabled) {
        if (btnUrl)  btnUrl.disabled  = !enabled;
        if (btnLive) btnLive.disabled = !enabled;
        if (btnStop) btnStop.disabled = true; // stop only enabled when streaming
    }

    function showPreview(stream) {
        if (!adminPreview) return;
        adminPreview.srcObject = stream;
        adminPreview.style.display = 'block';
        if (previewPH) previewPH.style.display = 'none';
    }

    function hidePreview() {
        if (!adminPreview) return;
        adminPreview.srcObject = null;
        adminPreview.style.display = 'none';
        if (previewPH) previewPH.style.display = 'block';
    }

    function showLiveBadge(show) {
        if (liveBadgePreview) {
            liveBadgePreview.classList.toggle('d-none', !show);
        }
    }

    // ── IPTV / Xtream Codes ───────────────────────────────────────────────────

    var iptvCfgEl   = document.getElementById('iptv-config');
    var streamBase  = iptvCfgEl ? iptvCfgEl.dataset.streamBase : '/streaming/stream/live/';
    var apiBase     = iptvCfgEl ? iptvCfgEl.dataset.apiBase    : '/streaming/admin/iptv';

    var iptvServer  = document.getElementById('iptv-server');
    var iptvUser    = document.getElementById('iptv-user');
    var iptvPass    = document.getElementById('iptv-pass');
    var btnConnect  = document.getElementById('btn-iptv-connect');
    var iptvBrowser = document.getElementById('iptv-browser');
    var iptvLoading = document.getElementById('iptv-loading');
    var iptvError   = document.getElementById('iptv-error');
    var iptvStatusW = document.getElementById('iptv-status-wrap');
    var iptvStBadge = document.getElementById('iptv-status-badge');
    var iptvStText  = document.getElementById('iptv-status-text');
    var iptvExpiry  = document.getElementById('iptv-expiry');
    var iptvCatSel  = document.getElementById('iptv-categories');
    var iptvSearch  = document.getElementById('iptv-search');
    var iptvChList  = document.getElementById('iptv-channel-list');
    var iptvChCount = document.getElementById('iptv-channel-count');
    var iptvListPH  = document.getElementById('iptv-list-placeholder');

    var iptvAllChannels = [];    // todos los canales de la categoría actual
    var iptvHls = null;          // HLS.js preview en admin

    // ── Conectar proveedor ────────────────────────────────────────────────────
    if (btnConnect) {
        btnConnect.addEventListener('click', function () {
            var srv  = iptvServer ? iptvServer.value.trim() : '';
            var usr  = iptvUser   ? iptvUser.value.trim()   : '';
            var pwd  = iptvPass   ? iptvPass.value.trim()   : '';
            if (!srv || !usr || !pwd) {
                iptvShowError('Completa los 3 campos: servidor, usuario y contraseña.');
                return;
            }
            iptvHideError();
            btnConnect.disabled = true;
            btnConnect.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Conectando…';

            fetch(apiBase + '/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serverUrl: srv, username: usr, password: pwd })
            })
            .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
            .then(function (res) {
                btnConnect.disabled = false;
                btnConnect.innerHTML = '<i class="mdi mdi-connection me-1"></i> Conectar / Probar';
                if (!res.ok || res.d.error) {
                    iptvShowError(res.d.error || 'Error desconocido');
                    return;
                }
                // Mostrar estado de cuenta
                var ui = res.d.user_info || {};
                var status = ui.status || 'Active';
                var expRaw = ui.exp_date;
                var expStr = '';
                if (expRaw && expRaw !== 'null' && expRaw !== 'Unlimited') {
                    try {
                        expStr = 'Expira: ' + new Date(parseInt(expRaw) * 1000).toLocaleDateString();
                    } catch (e) { expStr = 'Expira: ' + expRaw; }
                } else if (expRaw === 'Unlimited') {
                    expStr = 'Sin vencimiento';
                }
                iptvSetStatus(status === 'Active', status, expStr);
                if (iptvBrowser) iptvBrowser.style.display = 'block';
                iptvLoadCategories();
            })
            .catch(function (e) {
                btnConnect.disabled = false;
                btnConnect.innerHTML = '<i class="mdi mdi-connection me-1"></i> Conectar / Probar';
                iptvShowError('Error de red: ' + e.message);
            });
        });
    }

    // ── Categorías ────────────────────────────────────────────────────────────
    function iptvLoadCategories() {
        if (!iptvCatSel) return;
        fetch(apiBase + '/categories')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!Array.isArray(data)) return;
                iptvCatSel.innerHTML = '<option value="">— Todas las categorías —</option>';
                data.forEach(function (cat) {
                    var opt = document.createElement('option');
                    opt.value = cat.category_id || cat.id || '';
                    opt.textContent = cat.category_name || cat.name || '(Sin nombre)';
                    iptvCatSel.appendChild(opt);
                });
                // Cargar todos los canales por defecto
                iptvLoadChannels('');
            })
            .catch(function (e) { iptvShowError('Error al cargar categorías: ' + e.message); });
    }

    if (iptvCatSel) {
        iptvCatSel.addEventListener('change', function () {
            iptvLoadChannels(this.value);
        });
    }

    function iptvLoadChannels(categoryId) {
        if (iptvLoading)  iptvLoading.style.display = 'block';
        if (iptvBrowser)  iptvBrowser.style.display = 'none';
        var url = apiBase + '/streams' + (categoryId ? '?category_id=' + categoryId : '');
        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (iptvLoading)  iptvLoading.style.display = 'none';
                if (iptvBrowser)  iptvBrowser.style.display = 'block';
                if (!Array.isArray(data)) {
                    iptvShowError(data.error || 'Respuesta inesperada del proveedor');
                    return;
                }
                iptvAllChannels = data;
                iptvRenderChannels(data);
            })
            .catch(function (e) {
                if (iptvLoading) iptvLoading.style.display = 'none';
                if (iptvBrowser) iptvBrowser.style.display = 'block';
                iptvShowError('Error al cargar canales: ' + e.message);
            });
    }

    // ── Búsqueda ──────────────────────────────────────────────────────────────
    if (iptvSearch) {
        iptvSearch.addEventListener('input', function () {
            var q = this.value.toLowerCase();
            var filtered = q
                ? iptvAllChannels.filter(function (c) {
                    return (c.name || '').toLowerCase().indexOf(q) !== -1;
                  })
                : iptvAllChannels;
            iptvRenderChannels(filtered);
        });
    }

    // ── Renderizar canales ────────────────────────────────────────────────────
    function iptvRenderChannels(channels) {
        if (!iptvChList) return;
        if (iptvChCount) iptvChCount.textContent = channels.length + ' canales';

        if (channels.length === 0) {
            iptvChList.innerHTML = '<div class="text-center text-muted p-4 small">No se encontraron canales</div>';
            return;
        }

        var frag = document.createDocumentFragment();
        channels.forEach(function (ch) {
            var id   = ch.stream_id || ch.id || '';
            var name = ch.name || '(Sin nombre)';
            var icon = ch.stream_icon || ch.icon || '';

            var row = document.createElement('div');
            row.className = 'iptv-channel-row';

            var img = document.createElement('img');
            img.className = 'iptv-channel-logo';
            img.alt = name;
            if (icon) {
                img.src = icon;
                img.onerror = function () { this.src = ''; this.style.display='none'; };
            } else {
                img.style.display = 'none';
            }

            var nm = document.createElement('span');
            nm.className = 'iptv-channel-name';
            nm.textContent = name;

            var btn = document.createElement('button');
            btn.className = 'btn btn-sm btn-outline-warning btn-transmit-iptv';
            btn.innerHTML = '<i class="mdi mdi-television-play me-1"></i> Transmitir';
            btn.dataset.streamId = id;
            btn.dataset.channelName = name;
            btn.addEventListener('click', function () {
                iptvTransmit(this.dataset.streamId, this.dataset.channelName);
            });

            row.appendChild(img);
            row.appendChild(nm);
            row.appendChild(btn);
            frag.appendChild(row);
        });

        iptvChList.innerHTML = '';
        if (iptvListPH) iptvListPH.style.display = 'none';
        iptvChList.appendChild(frag);
    }

    // ── Transmitir canal IPTV ─────────────────────────────────────────────────
    function iptvTransmit(streamId, channelName) {
        if (!streamId) return;
        var src = streamBase + streamId + '.m3u8';

        // Detener stream previo
        stopLiveStream();

        // Publicar a viewers vía WebSocket (mismo flujo que modo enlace)
        send({ type: 'mode', mode: 'url', src: src });
        setStatus('IPTV: ' + channelName, 'warning', 'mdi-television-classic');
        showLiveBadge(false);
        if (btnStop) btnStop.disabled = false;
        if (btnUrl)  btnUrl.disabled  = true;
        if (btnLive) btnLive.disabled = true;

        // Vista previa en admin con HLS.js
        iptvPreviewChannel(src);
    }

    function iptvPreviewChannel(src) {
        if (adminPreview) {
            if (iptvHls) { iptvHls.destroy(); iptvHls = null; }
            adminPreview.srcObject = null;
            if (window.Hls && Hls.isSupported()) {
                iptvHls = new Hls({ enableWorker: true, lowLatencyMode: true });
                iptvHls.loadSource(src);
                iptvHls.attachMedia(adminPreview);
                iptvHls.on(Hls.Events.MANIFEST_PARSED, function () { adminPreview.play(); });
            } else if (adminPreview.canPlayType('application/vnd.apple.mpegurl')) {
                adminPreview.src = src;
                adminPreview.play();
            }
            adminPreview.style.display = 'block';
            if (previewPH) previewPH.style.display = 'none';
        }
    }

    // Destruir HLS admin al parar
    var _origStopLive = stopLiveStream;
    stopLiveStream = function () {
        _origStopLive();
        if (iptvHls) { iptvHls.destroy(); iptvHls = null; }
    };

    // ── Helpers estado IPTV ───────────────────────────────────────────────────
    function iptvSetStatus(ok, label, expiry) {
        if (iptvStatusW) iptvStatusW.style.display = 'block';
        if (iptvStBadge) {
            iptvStBadge.className = 'badge px-2 py-1 bg-' + (ok ? 'success' : 'danger');
        }
        if (iptvStText)  iptvStText.textContent  = label || (ok ? 'Activo' : 'Inactivo');
        if (iptvExpiry)  iptvExpiry.textContent  = expiry || '';
    }

    function iptvShowError(msg) {
        if (iptvError) {
            iptvError.textContent = msg;
            iptvError.style.display = 'block';
        }
    }

    function iptvHideError() {
        if (iptvError) iptvError.style.display = 'none';
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    connect();
})();
