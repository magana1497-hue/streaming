package sv.gob.isp.streaming.service;

import org.springframework.stereotype.Service;

import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Mapea URLs upstream (con credenciales del proveedor IPTV) a tokens opacos de corta vida.
 * Así el viewer nunca ve usuario/contraseña del proveedor en su navegador.
 *
 * TTL se renueva en cada acceso: los segmentos .ts expiran solos después de descargarse;
 * las playlists .m3u8 (que HLS.js refresca periódicamente) se mantienen vivas.
 */
@Service
public class ProxyTokenService {

    /** 2 minutos desde el último acceso. */
    private static final long TTL_MS = 120_000L;
    /** Limpiar entradas viejas cuando el mapa supera este tamaño. */
    private static final int CLEANUP_THRESHOLD = 5_000;

    private final ConcurrentHashMap<String, TokenEntry> tokens = new ConcurrentHashMap<>();

    /** Crea un token opaco que mapea a la URL upstream dada. */
    public String createToken(String url) {
        if (tokens.size() > CLEANUP_THRESHOLD) {
            tokens.entrySet().removeIf(e -> e.getValue().isExpired());
        }
        String token = UUID.randomUUID().toString().replace("-", "");
        tokens.put(token, new TokenEntry(url));
        return token;
    }

    /**
     * Resuelve el token a su URL original y renueva el TTL (sliding expiry).
     * Devuelve null si el token no existe o expiró.
     */
    public String resolveToken(String token) {
        TokenEntry entry = tokens.get(token);
        if (entry == null || entry.isExpired()) {
            tokens.remove(token);
            return null;
        }
        // Renew TTL on access (sliding expiry)
        tokens.put(token, new TokenEntry(entry.url));
        return entry.url;
    }

    // ── Inner class ───────────────────────────────────────────────────────────

    private static final class TokenEntry {
        final String url;
        final long expiresAt;

        TokenEntry(String url) {
            this.url = url;
            this.expiresAt = System.currentTimeMillis() + TTL_MS;
        }

        boolean isExpired() {
            return System.currentTimeMillis() > expiresAt;
        }
    }
}
