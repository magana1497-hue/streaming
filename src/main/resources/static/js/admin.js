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
    const statusBadge        = document.getElementById('status-badge');
    const viewerCountNum     = document.getElementById('viewer-count-num');
    const btnUrl             = document.getElementById('btn-url');
    const btnLive            = document.getElementById('btn-live');
    const btnStop            = document.getElementById('btn-stop');
    const videoUrlInput      = document.getElementById('video-url');
    const adminPreview       = document.getElementById('admin-preview');
    const previewPH          = document.getElementById('preview-placeholder');
    const liveBadgePreview   = document.getElementById('live-badge-preview');
    const viewerLinkInput    = document.getElementById('viewer-link');
    const btnCopyLink        = document.getElementById('btn-copy-link');
    const streamOverlay      = document.getElementById('stream-loading-overlay');
    const streamLoadingMsg   = document.getElementById('stream-loading-msg');
    const streamLoadingSub   = document.getElementById('stream-loading-sub');

    // ── Loading overlay ───────────────────────────────────────────────────────
    function showOverlay(msg, sub) {
        console.log('[Stream] overlay show —', msg, sub || '');
        if (streamLoadingMsg) streamLoadingMsg.textContent = msg || 'Cargando…';
        if (streamLoadingSub) streamLoadingSub.textContent = sub || '';
        if (streamOverlay)    streamOverlay.style.display = 'flex';
    }

    function hideOverlay() {
        console.log('[Stream] overlay hide');
        if (streamOverlay) streamOverlay.style.display = 'none';
    }

    // ── Viewer link ───────────────────────────────────────────────────────────
    if (viewerLinkInput) {
        viewerLinkInput.value = window.location.origin + viewerUrl;
        console.log('[Admin] viewer link set to', viewerLinkInput.value);
    }

    if (btnCopyLink) {
        btnCopyLink.addEventListener('click', function () {
            navigator.clipboard.writeText(viewerLinkInput.value).then(function () {
                console.log('[Admin] viewer link copied to clipboard');
                btnCopyLink.innerHTML = '<i class="mdi mdi-check"></i>';
                setTimeout(function () {
                    btnCopyLink.innerHTML = '<i class="mdi mdi-content-copy"></i>';
                }, 2000);
            });
        });
    }

    // ── WebSocket ─────────────────────────────────────────────────────────────
    function connect() {
        const url = wsProto + '//' + window.location.host + wsPath + '?role=admin';
        console.log('[WS] connecting to', url);
        ws = new WebSocket(url);

        ws.onopen = function () {
            console.log('[WS] connection established');
            setStatus('CONECTADO', 'success', 'mdi-circle');
            enableControls(true);
        };

        ws.onmessage = function (evt) {
            try {
                const msg = JSON.parse(evt.data);
                console.log('[WS] ← received', msg.type, msg);
                handleMsg(msg);
            } catch (e) {
                console.error('[WS] parse error', e, evt.data);
            }
        };

        ws.onclose = function (evt) {
            console.warn('[WS] connection closed — code:', evt.code, 'reason:', evt.reason || '(none)');
            setStatus('DESCONECTADO', 'secondary', 'mdi-circle-outline');
            enableControls(false);
            setTimeout(connect, 3000);
        };

        ws.onerror = function (err) {
            console.error('[WS] error', err);
            ws.close();
        };
    }

    function send(obj) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            console.log('[WS] → sending', obj.type, obj);
            ws.send(JSON.stringify(obj));
        } else {
            console.warn('[WS] send skipped — not open (state=' + (ws ? ws.readyState : 'null') + ')', obj);
        }
    }

    // ── Message handling ──────────────────────────────────────────────────────
    function handleMsg(msg) {
        switch (msg.type) {
            case 'init':
                console.log('[WS] init — viewerCount:', msg.viewerCount);
                updateViewerCount(msg.viewerCount);
                break;
            case 'viewer-joined':
                console.log('[WS] viewer joined — id:', msg.viewerId, 'total:', msg.viewerCount);
                updateViewerCount(msg.viewerCount);
                if (localStream) {
                    console.log('[WebRTC] creating offer for new viewer', msg.viewerId);
                    createOffer(msg.viewerId);
                } else {
                    console.log('[WebRTC] viewer joined but no local stream — skipping offer');
                }
                break;
            case 'viewer-left':
                console.log('[WS] viewer left — id:', msg.viewerId, 'total:', msg.viewerCount);
                updateViewerCount(msg.viewerCount);
                closePeer(msg.viewerId);
                break;
            case 'answer':
                console.log('[WebRTC] received answer from viewer', msg.from);
                applyAnswer(msg.from, msg.answer);
                break;
            case 'ice':
                console.log('[WebRTC] received ICE candidate from', msg.from);
                addIce(msg.from, msg.candidate);
                break;
            default:
                console.warn('[WS] unknown message type:', msg.type, msg);
        }
    }

    // ── WebRTC ────────────────────────────────────────────────────────────────
    function createOffer(viewerId) {
        console.log('[WebRTC] createOffer — viewerId:', viewerId);
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        peers[viewerId] = pc;

        localStream.getTracks().forEach(function (track) {
            console.log('[WebRTC] adding track', track.kind, track.label, '→', viewerId);
            pc.addTrack(track, localStream);
        });

        pc.onicecandidate = function (evt) {
            if (evt.candidate) {
                console.log('[WebRTC] ICE candidate →', viewerId, evt.candidate.type);
                send({ type: 'ice', target: viewerId, candidate: evt.candidate });
            } else {
                console.log('[WebRTC] ICE gathering complete for', viewerId);
            }
        };

        pc.oniceconnectionstatechange = function () {
            console.log('[WebRTC] ICE state →', viewerId, ':', pc.iceConnectionState);
            if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
                console.log('[WebRTC] connected to', viewerId, '— applying bitrate params');
                pc.getSenders().forEach(function (sender) {
                    if (!sender.track) return;
                    var params = sender.getParameters();
                    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
                    if (sender.track.kind === 'video') {
                        params.encodings[0].maxBitrate            = 30 * 1024 * 1024;
                        params.encodings[0].maxFramerate          = 60;
                        params.encodings[0].degradationPreference = 'maintain-resolution';
                        console.log('[WebRTC] video params: 30Mbps @60fps maintain-resolution');
                    } else {
                        params.encodings[0].maxBitrate = 320 * 1024;
                        console.log('[WebRTC] audio params: 320kbps');
                    }
                    sender.setParameters(params).catch(function (e) {
                        console.warn('[WebRTC] setParameters error', e);
                    });
                });
            } else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
                console.warn('[WebRTC] peer', viewerId, 'state:', pc.iceConnectionState);
            }
        };

        pc.createOffer()
            .then(function (offer) {
                console.log('[WebRTC] offer created for', viewerId);
                return pc.setLocalDescription(offer);
            })
            .then(function () {
                console.log('[WebRTC] local description set — sending offer to', viewerId);
                send({ type: 'offer', target: viewerId, offer: pc.localDescription });
            })
            .catch(function (err) {
                console.error('[WebRTC] createOffer error for', viewerId, err);
            });
    }

    function applyAnswer(viewerId, answer) {
        const pc = peers[viewerId];
        if (pc) {
            console.log('[WebRTC] applying answer from', viewerId);
            pc.setRemoteDescription(new RTCSessionDescription(answer))
                .then(function () { console.log('[WebRTC] remote description set for', viewerId); })
                .catch(function (err) { console.error('[WebRTC] setRemoteDesc error', viewerId, err); });
        } else {
            console.warn('[WebRTC] received answer but no peer for', viewerId);
        }
    }

    function addIce(viewerId, candidate) {
        const pc = peers[viewerId];
        if (pc && candidate) {
            pc.addIceCandidate(new RTCIceCandidate(candidate))
                .catch(function (err) { console.error('[WebRTC] addIce error', viewerId, err); });
        }
    }

    function closePeer(viewerId) {
        if (peers[viewerId]) {
            console.log('[WebRTC] closing peer connection for', viewerId);
            peers[viewerId].close();
            delete peers[viewerId];
        }
    }

    function closeAllPeers() {
        console.log('[WebRTC] closing all peer connections:', Object.keys(peers));
        Object.keys(peers).forEach(closePeer);
    }

    // ── Button handlers ───────────────────────────────────────────────────────
    if (btnUrl) {
        btnUrl.addEventListener('click', function () {
            var url = videoUrlInput.value.trim();
            if (!url) { alert('Ingrese una URL de video válida.'); return; }
            console.log('[Stream] URL mode requested — src:', url);
            showOverlay('Cargando enlace de video…', url);
            stopLiveStream();
            send({ type: 'mode', mode: 'url', src: url });
            setStatus('ENLACE ACTIVO', 'primary', 'mdi-link-variant');
            showLiveBadge(false);
            btnStop.disabled = false;
            btnUrl.disabled  = true;
            btnLive.disabled = true;
            // Overlay se esconde cuando el video empieza a reproducirse
            if (adminPreview) {
                adminPreview.addEventListener('playing', function onPlaying() {
                    console.log('[Stream] URL video playing');
                    hideOverlay();
                    adminPreview.removeEventListener('playing', onPlaying);
                });
            }
        });
    }

    if (btnLive) {
        btnLive.addEventListener('click', function () {
            console.log('[Stream] Live mode requested — calling getDisplayMedia');
            showOverlay('Esperando permiso de captura de pantalla…', 'Acepta el diálogo del navegador');
            navigator.mediaDevices.getDisplayMedia({
                    video: {
                        frameRate: { ideal: 60, max: 60 },
                        width:     { ideal: window.screen.width,  max: window.screen.width  },
                        height:    { ideal: window.screen.height, max: window.screen.height }
                    },
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl:  false
                    }
                })
                .then(function (stream) {
                    console.log('[Stream] display media granted — tracks:', stream.getTracks().map(function(t){ return t.kind + ':' + t.label; }));
                    showOverlay('Iniciando transmisión en vivo…', 'Capturando pantalla');
                    var vt = stream.getVideoTracks()[0];
                    if (vt) {
                        vt.contentHint = 'detail';
                        vt.applyConstraints({
                            frameRate: { ideal: 60, max: 60 },
                            width:     { ideal: window.screen.width  },
                            height:    { ideal: window.screen.height }
                        }).catch(function (e) { console.warn('[Stream] applyConstraints failed', e); });
                    }
                    localStream = stream;
                    showPreview(stream);
                    hideOverlay();
                    send({ type: 'mode', mode: 'live' });
                    setStatus('EN VIVO', 'danger', 'mdi-broadcast');
                    showLiveBadge(true);
                    btnStop.disabled = false;
                    btnUrl.disabled  = true;
                    btnLive.disabled = true;

                    var videoTrack = stream.getVideoTracks()[0];
                    if (videoTrack) {
                        videoTrack.onended = function () {
                            console.log('[Stream] video track ended by user (browser stop button)');
                            btnStop.click();
                        };
                    }
                })
                .catch(function (err) {
                    hideOverlay();
                    if (err.name !== 'NotAllowedError') {
                        console.error('[Stream] getDisplayMedia error', err.name, err.message);
                        alert('Error al capturar pantalla: ' + err.message);
                    } else {
                        console.warn('[Stream] getDisplayMedia denied by user');
                    }
                });
        });
    }

    if (btnStop) {
        btnStop.addEventListener('click', function () {
            console.log('[Stream] stop requested');
            stopLiveStream();
            send({ type: 'mode', mode: 'off' });
            setStatus('CONECTADO', 'success', 'mdi-circle');
            showLiveBadge(false);
            hideOverlay();
            btnStop.disabled = true;
            enableControls(true);
            videoUrlInput.value = '';
        });
    }

    function stopLiveStream() {
        if (localStream) {
            console.log('[Stream] stopping local stream tracks');
            localStream.getTracks().forEach(function (t) {
                console.log('[Stream] stopping track', t.kind, t.label);
                t.stop();
            });
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
        if (btnStop) btnStop.disabled = true;
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

    // Pre-fill fields from server-side defaults (application.properties)
    if (iptvCfgEl) {
        if (iptvServer && iptvCfgEl.dataset.iptvServer) iptvServer.value = iptvCfgEl.dataset.iptvServer;
        if (iptvUser   && iptvCfgEl.dataset.iptvUser)   iptvUser.value   = iptvCfgEl.dataset.iptvUser;
        if (iptvPass   && iptvCfgEl.dataset.iptvPass)   iptvPass.value   = iptvCfgEl.dataset.iptvPass;
        console.log('[IPTV] pre-filled credentials from server defaults — server:', iptvCfgEl.dataset.iptvServer, 'user:', iptvCfgEl.dataset.iptvUser);
    }

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

    var iptvAllChannels = [];
    var iptvHls = null;

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
            console.log('[IPTV] connect attempt — server:', srv, 'user:', usr);
            iptvHideError();
            btnConnect.disabled = true;
            btnConnect.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Conectando…';

            var t0 = Date.now();
            fetch(apiBase + '/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serverUrl: srv, username: usr, password: pwd })
            })
            .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); })
            .then(function (res) {
                console.log('[IPTV] connect response in', Date.now() - t0, 'ms — HTTP', res.status, res.d);
                btnConnect.disabled = false;
                btnConnect.innerHTML = '<i class="mdi mdi-connection me-1"></i> Conectar / Probar';
                if (!res.ok || res.d.error) {
                    console.error('[IPTV] connect failed:', res.d.error || 'unknown');
                    iptvShowError(res.d.error || 'Error desconocido');
                    return;
                }
                var ui = res.d.user_info || {};
                var si = res.d.server_info || {};
                console.log('[IPTV] account status:', ui.status, '| expiry:', ui.exp_date, '| server timezone:', si.timezone);
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
                console.error('[IPTV] connect network error:', e.message);
                btnConnect.disabled = false;
                btnConnect.innerHTML = '<i class="mdi mdi-connection me-1"></i> Conectar / Probar';
                iptvShowError('Error de red: ' + e.message);
            });
        });
    }

    // ── Categorías ────────────────────────────────────────────────────────────
    function iptvLoadCategories() {
        if (!iptvCatSel) return;
        console.log('[IPTV] loading categories from', apiBase + '/categories');
        var t0 = Date.now();
        fetch(apiBase + '/categories')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                console.log('[IPTV] categories loaded in', Date.now() - t0, 'ms —', Array.isArray(data) ? data.length : 0, 'categories');
                if (!Array.isArray(data)) {
                    console.error('[IPTV] unexpected categories response:', data);
                    return;
                }
                iptvCatSel.innerHTML = '<option value="">— Todas las categorías —</option>';
                data.forEach(function (cat) {
                    var opt = document.createElement('option');
                    opt.value = cat.category_id || cat.id || '';
                    opt.textContent = cat.category_name || cat.name || '(Sin nombre)';
                    iptvCatSel.appendChild(opt);
                });
                iptvLoadChannels('');
            })
            .catch(function (e) {
                console.error('[IPTV] categories fetch error:', e.message);
                iptvShowError('Error al cargar categorías: ' + e.message);
            });
    }

    if (iptvCatSel) {
        iptvCatSel.addEventListener('change', function () {
            console.log('[IPTV] category changed — id:', this.value || '(all)');
            iptvLoadChannels(this.value);
        });
    }

    function iptvLoadChannels(categoryId) {
        if (iptvLoading)  iptvLoading.style.display = 'block';
        if (iptvBrowser)  iptvBrowser.style.display = 'none';
        var url = apiBase + '/streams' + (categoryId ? '?category_id=' + categoryId : '');
        console.log('[IPTV] loading channels from', url);
        var t0 = Date.now();
        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var elapsed = Date.now() - t0;
                if (iptvLoading)  iptvLoading.style.display = 'none';
                if (iptvBrowser)  iptvBrowser.style.display = 'block';
                if (!Array.isArray(data)) {
                    console.error('[IPTV] unexpected streams response in', elapsed, 'ms:', data);
                    iptvShowError(data.error || 'Respuesta inesperada del proveedor');
                    return;
                }
                console.log('[IPTV] channels loaded in', elapsed, 'ms —', data.length, 'channels for category:', categoryId || 'all');
                iptvAllChannels = data;
                iptvRenderChannels(data);
            })
            .catch(function (e) {
                console.error('[IPTV] channels fetch error:', e.message);
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
            console.log('[IPTV] search "' + q + '" — matched', filtered.length, 'channels');
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
        console.log('[IPTV] rendered', channels.length, 'channel rows');
    }

    // ── Transmitir canal IPTV ─────────────────────────────────────────────────
    function iptvTransmit(streamId, channelName) {
        if (!streamId) return;
        var src = streamBase + streamId + '.m3u8';
        console.log('[IPTV] transmit requested — channel:', channelName, 'id:', streamId, 'src:', src);
        showOverlay('Conectando canal IPTV…', channelName);
        stopLiveStream();

        iptvPreviewChannel(src, channelName, function (stream) {
            console.log('[IPTV] stream captured — sending live mode to viewers');
            localStream = stream;
            send({ type: 'mode', mode: 'live' });
            setStatus('IPTV: ' + channelName, 'warning', 'mdi-television-classic');
            showLiveBadge(false);
            hideOverlay();
            if (btnStop) btnStop.disabled = false;
            if (btnUrl)  btnUrl.disabled  = true;
            if (btnLive) btnLive.disabled = true;
        });
    }

    function iptvPreviewChannel(src, channelName, onCapture) {
        if (!adminPreview) return;
        if (iptvHls) {
            console.log('[IPTV] destroying previous HLS instance');
            iptvHls.destroy();
            iptvHls = null;
        }
        adminPreview.srcObject = null;
        console.log('[IPTV] loading HLS source:', src);

        function captureAndNotify() {
            console.log('[IPTV] video playing — capturing stream');
            var stream = adminPreview.captureStream
                ? adminPreview.captureStream()
                : adminPreview.mozCaptureStream
                ? adminPreview.mozCaptureStream()
                : null;
            if (stream) {
                console.log('[IPTV] captured stream tracks:', stream.getTracks().map(function(t){ return t.kind; }));
                if (onCapture) onCapture(stream);
            } else {
                console.error('[IPTV] captureStream not supported in this browser');
                hideOverlay();
            }
        }

        if (window.Hls && Hls.isSupported()) {
            console.log('[IPTV] using HLS.js to load stream');
            iptvHls = new Hls({ enableWorker: true, lowLatencyMode: false });
            iptvHls.loadSource(src);
            iptvHls.attachMedia(adminPreview);
            iptvHls.on(Hls.Events.MANIFEST_PARSED, function (evt, data) {
                console.log('[IPTV] HLS manifest parsed — levels:', data.levels.length, '— starting playback');
                showOverlay('Iniciando reproducción…', channelName);
                adminPreview.muted = true;
                adminPreview.play()
                    .then(captureAndNotify)
                    .catch(function (e) {
                        console.error('[IPTV] play error after manifest parse:', e.message);
                        hideOverlay();
                    });
            });
            iptvHls.on(Hls.Events.LEVEL_LOADED, function (evt, data) {
                console.log('[IPTV] HLS level loaded — level:', data.level, 'fragments:', data.details.fragments.length);
            });
            iptvHls.on(Hls.Events.ERROR, function (evt, data) {
                console.error('[IPTV] HLS error — type:', data.type, 'details:', data.details, 'fatal:', data.fatal, 'url:', data.url || (data.context && data.context.url));
                if (data.fatal) {
                    console.error('[IPTV] HLS fatal error — stopping', data);
                    hideOverlay();
                    iptvShowError('Error HLS fatal (' + data.details + '): verifica conexión o credenciales del proveedor');
                }
            });
        } else if (adminPreview.canPlayType('application/vnd.apple.mpegurl')) {
            console.log('[IPTV] using native HLS (Safari/iOS)');
            adminPreview.src = src;
            adminPreview.muted = true;
            adminPreview.addEventListener('playing', captureAndNotify, { once: true });
            adminPreview.play().catch(function (e) {
                console.error('[IPTV] native HLS play error:', e.message);
                hideOverlay();
            });
        } else {
            console.error('[IPTV] HLS not supported in this browser');
            hideOverlay();
            iptvShowError('Tu navegador no soporta HLS. Usa Chrome o Edge.');
        }

        adminPreview.style.display = 'block';
        if (previewPH) previewPH.style.display = 'none';
    }

    // Destruir HLS admin al parar
    var _origStopLive = stopLiveStream;
    stopLiveStream = function () {
        _origStopLive();
        if (iptvHls) {
            console.log('[IPTV] destroying HLS instance on stop');
            iptvHls.destroy();
            iptvHls = null;
        }
    };

    // ── Helpers estado IPTV ───────────────────────────────────────────────────
    function iptvSetStatus(ok, label, expiry) {
        if (iptvStatusW) iptvStatusW.style.display = 'block';
        if (iptvStBadge) {
            iptvStBadge.className = 'badge px-2 py-1 bg-' + (ok ? 'success' : 'danger');
        }
        if (iptvStText)  iptvStText.textContent  = label || (ok ? 'Activo' : 'Inactivo');
        if (iptvExpiry)  iptvExpiry.textContent  = expiry || '';
        console.log('[IPTV] status set — ok:', ok, 'label:', label, 'expiry:', expiry);
    }

    function iptvShowError(msg) {
        console.error('[IPTV] showing error to user:', msg);
        if (iptvError) {
            iptvError.textContent = msg;
            iptvError.style.display = 'block';
        }
    }

    function iptvHideError() {
        if (iptvError) iptvError.style.display = 'none';
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    console.log('[Admin] initializing — wsPath:', wsPath, 'viewerUrl:', viewerUrl, 'streamBase:', streamBase, 'apiBase:', apiBase);
    connect();
})();
