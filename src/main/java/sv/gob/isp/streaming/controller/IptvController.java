package sv.gob.isp.streaming.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import sv.gob.isp.streaming.service.IptvConfigService;
import sv.gob.isp.streaming.service.IptvService;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/admin/iptv")
public class IptvController {

    private static final Logger log = LoggerFactory.getLogger(IptvController.class);

    @Autowired
    private IptvConfigService config;

    @Autowired
    private IptvService iptvService;

    private final ObjectMapper mapper = new ObjectMapper();

    /**
     * Guarda credenciales y verifica la conexión con el proveedor Xtream.
     * Body JSON: { "serverUrl": "...", "username": "...", "password": "..." }
     * Responde con el JSON crudo de user_info + server_info, o un objeto de error.
     */
    @PostMapping(value = "/config", consumes = MediaType.APPLICATION_JSON_VALUE,
                 produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> configure(@RequestBody Map<String, String> body) {
        String serverUrl = body.get("serverUrl");
        String username  = body.get("username");
        String password  = body.get("password");

        if (serverUrl == null || serverUrl.isBlank()
                || username == null || username.isBlank()
                || password == null || password.isBlank()) {
            return ResponseEntity.badRequest()
                    .body("{\"error\":\"Faltan campos: serverUrl, username, password\"}");
        }

        log.info("IPTV configure — server: {} user: {}", serverUrl.trim(), username.trim());
        config.configure(serverUrl.trim(), username.trim(), password.trim());

        long t0 = System.currentTimeMillis();
        try {
            String raw = iptvService.testConnection();
            long elapsed = System.currentTimeMillis() - t0;

            try {
                JsonNode root = mapper.readTree(raw);
                JsonNode userInfo = root.path("user_info");
                String status = userInfo.path("status").asText("Unknown");
                String expDate = userInfo.path("exp_date").asText(null);
                int maxConnections = userInfo.path("max_connections").asInt(0);
                int activeConnections = userInfo.path("active_cons").asInt(0);
                log.info("IPTV connect OK in {}ms — status: {} exp: {} connections: {}/{}", elapsed, status, expDate, activeConnections, maxConnections);
                config.setAccountStatus(status);
                if (expDate != null && !expDate.equals("null") && !expDate.isBlank()) {
                    try {
                        long epochSec = Long.parseLong(expDate);
                        String formatted = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")
                                .withZone(ZoneId.systemDefault())
                                .format(Instant.ofEpochSecond(epochSec));
                        config.setAccountExpiry(formatted);
                    } catch (NumberFormatException e) {
                        config.setAccountExpiry(expDate);
                    }
                }
            } catch (Exception ignored) { }

            config.setConnected(true);
            return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(raw);

        } catch (Exception e) {
            log.error("IPTV connect FAILED in {}ms — server: {} user: {} error: {}", System.currentTimeMillis() - t0, serverUrl.trim(), username.trim(), e.getMessage());
            config.setConnected(false);
            return ResponseEntity.status(502)
                    .body("{\"error\":\"" + escapeJson(e.getMessage()) + "\"}");
        }
    }

    /**
     * Devuelve la configuración actual (sin contraseña) y el estado de la conexión.
     */
    @GetMapping(value = "/config", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Map<String, Object>> getConfig() {
        Map<String, Object> info = new HashMap<>();
        info.put("serverUrl",     config.getServerUrl());
        info.put("username",      config.getUsername());
        info.put("connected",     config.isConnected());
        info.put("accountStatus", config.getAccountStatus());
        info.put("accountExpiry", config.getAccountExpiry());
        return ResponseEntity.ok(info);
    }

    @GetMapping(value = "/categories", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> categories() {
        if (!config.isConnected()) {
            log.warn("IPTV categories requested but provider not connected");
            return ResponseEntity.status(401)
                    .body("{\"error\":\"Proveedor no conectado\"}");
        }
        log.info("IPTV fetching live categories");
        long t0 = System.currentTimeMillis();
        try {
            String body = iptvService.getLiveCategories();
            log.info("IPTV categories OK in {}ms — {} bytes", System.currentTimeMillis() - t0, body.length());
            return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(body);
        } catch (Exception e) {
            log.error("IPTV categories FAILED in {}ms — {}", System.currentTimeMillis() - t0, e.getMessage());
            return ResponseEntity.status(502)
                    .body("{\"error\":\"" + escapeJson(e.getMessage()) + "\"}");
        }
    }

    @GetMapping(value = "/streams", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> streams(
            @RequestParam(value = "category_id", required = false) String categoryId) {
        if (!config.isConnected()) {
            log.warn("IPTV streams requested but provider not connected");
            return ResponseEntity.status(401)
                    .body("{\"error\":\"Proveedor no conectado\"}");
        }
        log.info("IPTV fetching live streams — category: {}", categoryId != null ? categoryId : "all");
        long t0 = System.currentTimeMillis();
        try {
            String body = iptvService.getLiveStreams(categoryId);
            log.info("IPTV streams OK in {}ms — {} bytes", System.currentTimeMillis() - t0, body.length());
            return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(body);
        } catch (Exception e) {
            log.error("IPTV streams FAILED in {}ms — category: {} error: {}", System.currentTimeMillis() - t0, categoryId, e.getMessage());
            return ResponseEntity.status(502)
                    .body("{\"error\":\"" + escapeJson(e.getMessage()) + "\"}");
        }
    }

    private String escapeJson(String s) {
        if (s == null) return "Error desconocido";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
