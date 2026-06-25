package sv.gob.isp.streaming.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;
import sv.gob.isp.streaming.service.IptvConfigService;
import sv.gob.isp.streaming.service.ProxyTokenService;

import javax.annotation.PostConstruct;
import javax.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.ProxySelector;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Proxy transparente para streams HLS de Xtream Codes.
 *
 * GET /stream/live/{streamId}.m3u8  — punto de entrada (admin lo publica a viewers)
 * GET /stream/r/{token}             — proxy genérico de recursos (segmentos, sub-playlists, claves)
 *
 * Las credenciales del proveedor (usuario/contraseña) NUNCA salen del servidor:
 * todas las URLs downstream se sustituyen por tokens opacos de corta vida.
 */
@RestController
@RequestMapping("/stream")
public class StreamProxyController {

    private static final String MPEGURL_TYPE  = "application/vnd.apple.mpegurl";
    private static final String OCTET_TYPE    = "application/octet-stream";
    private static final Pattern TAG_URI_PATTERN = Pattern.compile("URI=\"([^\"]+)\"");

    @Autowired
    private IptvConfigService iptvConfig;

    @Autowired
    private ProxyTokenService tokenService;

    @Value("${app.iptv.proxy.host:}")
    private String proxyHost;

    @Value("${app.iptv.proxy.port:3128}")
    private int proxyPort;

    private HttpClient httpClient;

    @PostConstruct
    private void initClient() {
        HttpClient.Builder builder = HttpClient.newBuilder()
                .followRedirects(HttpClient.Redirect.ALWAYS)
                .connectTimeout(Duration.ofSeconds(15));
        if (proxyHost != null && !proxyHost.isBlank()) {
            builder.proxy(ProxySelector.of(new InetSocketAddress(proxyHost, proxyPort)));
        }
        httpClient = builder.build();
    }

    // ── Punto de entrada ──────────────────────────────────────────────────────

    /**
     * Descarga la playlist maestra del canal, reescribe todas las URLs internas
     * a tokens proxy y la devuelve al cliente.
     */
    @GetMapping(value = "/live/{streamId}.m3u8", produces = MPEGURL_TYPE)
    public ResponseEntity<String> getLivePlaylist(
            @PathVariable String streamId,
            HttpServletRequest request) {

        if (!iptvConfig.isConfigured()) {
            return ResponseEntity.status(503).body("# IPTV not configured");
        }

        String upstreamUrl = iptvConfig.buildStreamUrl(streamId);
        String proxyBase   = buildProxyBase(request);

        try {
            String m3u8    = fetchString(upstreamUrl);
            String baseUrl = parentUrl(upstreamUrl);
            String rewritten = rewriteM3u8(m3u8, baseUrl, proxyBase);
            return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType(MPEGURL_TYPE))
                    .header("Cache-Control", "no-cache, no-store")
                    .header("Access-Control-Allow-Origin", "*")
                    .body(rewritten);
        } catch (Exception e) {
            return ResponseEntity.status(502).body("# Upstream error: " + e.getMessage());
        }
    }

    // ── Proxy genérico de recursos ────────────────────────────────────────────

    /**
     * Resuelve el token a su URL real y reenvía los bytes (o reescribe si es m3u8).
     */
    @GetMapping("/r/{token}")
    public ResponseEntity<StreamingResponseBody> proxyResource(
            @PathVariable String token,
            HttpServletRequest request) {

        String targetUrl = tokenService.resolveToken(token);
        if (targetUrl == null) {
            return ResponseEntity.status(410).build(); // token expirado / no existe
        }

        try {
            HttpRequest upstreamReq = HttpRequest.newBuilder()
                    .uri(URI.create(targetUrl))
                    .timeout(Duration.ofSeconds(30))
                    .header("User-Agent", "Mozilla/5.0 ISPStreaming/1.0")
                    .GET()
                    .build();

            HttpResponse<InputStream> upstream = httpClient.send(
                    upstreamReq, HttpResponse.BodyHandlers.ofInputStream());

            String contentType = upstream.headers()
                    .firstValue("Content-Type")
                    .orElse(OCTET_TYPE)
                    .split(";")[0].trim();

            boolean isPlaylist = contentType.contains("mpegurl")
                    || targetUrl.toLowerCase().endsWith(".m3u8");

            if (isPlaylist) {
                // Reescribir sub-playlist antes de devolverla
                String proxyBase = buildProxyBase(request);
                String content   = new String(upstream.body().readAllBytes(), StandardCharsets.UTF_8);
                String baseUrl   = parentUrl(targetUrl);
                String rewritten = rewriteM3u8(content, baseUrl, proxyBase);
                byte[] bytes     = rewritten.getBytes(StandardCharsets.UTF_8);
                return ResponseEntity.ok()
                        .contentType(MediaType.parseMediaType(MPEGURL_TYPE))
                        .header("Cache-Control", "no-cache, no-store")
                        .header("Access-Control-Allow-Origin", "*")
                        .body(out -> {
                            out.write(bytes);
                            out.flush();
                        });
            }

            // Segmento .ts / clave AES / otro binario — stream directo
            final InputStream bodyStream = upstream.body();
            return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType(contentType))
                    .header("Cache-Control", "no-cache, no-store")
                    .header("Access-Control-Allow-Origin", "*")
                    .body(out -> {
                        byte[] buf = new byte[8192];
                        int n;
                        try {
                            while ((n = bodyStream.read(buf)) != -1) {
                                out.write(buf, 0, n);
                                out.flush();
                            }
                        } finally {
                            try { bodyStream.close(); } catch (IOException ignored) {}
                        }
                    });

        } catch (Exception e) {
            return ResponseEntity.status(502).build();
        }
    }

    // ── Reescritura de m3u8 ───────────────────────────────────────────────────

    /**
     * Recorre línea a línea el contenido HLS y sustituye toda URL externa por un token proxy.
     *  - Líneas URI (segmentos, playlists) → token directo.
     *  - Atributos URI="..." en tags (#EXT-X-KEY, #EXT-X-MAP…) → reescritos inline.
     */
    private String rewriteM3u8(String content, String baseUrl, String proxyBase) {
        return content.lines().map(line -> {
            String trimmed = line.trim();
            if (trimmed.isEmpty()) return line;

            if (trimmed.startsWith("#")) {
                // Reescribir URI= dentro de tags de atributos
                if (trimmed.contains("URI=\"")) {
                    return rewriteTagUris(trimmed, baseUrl, proxyBase);
                }
                return line;
            }

            // Línea de URL (segmento o sub-playlist)
            String absolute = resolveUrl(trimmed, baseUrl);
            String tkn      = tokenService.createToken(absolute);
            return proxyBase + tkn;

        }).collect(Collectors.joining("\n"));
    }

    /** Reescribe atributos URI="..." dentro de una línea de tag HLS. */
    private String rewriteTagUris(String tagLine, String baseUrl, String proxyBase) {
        Matcher m  = TAG_URI_PATTERN.matcher(tagLine);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            String uri      = m.group(1);
            String absolute = resolveUrl(uri, baseUrl);
            String tkn      = tokenService.createToken(absolute);
            m.appendReplacement(sb, "URI=\"" + proxyBase + tkn + "\"");
        }
        m.appendTail(sb);
        return sb.toString();
    }

    // ── Utilidades ────────────────────────────────────────────────────────────

    private String fetchString(String url) throws Exception {
        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(Duration.ofSeconds(15))
                .header("User-Agent", "Mozilla/5.0 ISPStreaming/1.0")
                .GET()
                .build();
        HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
        if (resp.statusCode() >= 400) {
            throw new RuntimeException("Upstream HTTP " + resp.statusCode());
        }
        return resp.body();
    }

    /** Directorio padre de la URL (para resolver URLs relativas). */
    private String parentUrl(String url) {
        int q = url.indexOf('?');
        String clean = q >= 0 ? url.substring(0, q) : url;
        int slash = clean.lastIndexOf('/');
        return slash > 0 ? clean.substring(0, slash + 1) : clean + "/";
    }

    /** Resuelve una URL potencialmente relativa contra la base dada. */
    private String resolveUrl(String url, String baseUrl) {
        if (url.startsWith("http://") || url.startsWith("https://")) return url;
        if (url.startsWith("//")) return "http:" + url;
        if (url.startsWith("/")) {
            try {
                URI base = new URI(baseUrl);
                int port = base.getPort();
                return base.getScheme() + "://" + base.getHost()
                        + (port > 0 ? ":" + port : "") + url;
            } catch (Exception e) { return baseUrl + url; }
        }
        return baseUrl + url;
    }

    /** Construye la base del proxy para reescribir URLs: http(s)://host:port/ctx/stream/r/ */
    private String buildProxyBase(HttpServletRequest request) {
        return request.getScheme() + "://"
                + request.getServerName() + ":" + request.getServerPort()
                + request.getContextPath() + "/stream/r/";
    }
}
