package sv.gob.isp.streaming.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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

/**
 * Endpoints del panel IPTV — todos bajo /admin/iptv/** (protegidos por hasRole('ADMIN')).
 */
@RestController
@RequestMapping("/admin/iptv")
public class IptvController {

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

        config.configure(serverUrl.trim(), username.trim(), password.trim());

        try {
            String raw = iptvService.testConnection();
            // Intentar extraer status y expiry para guardarlo en el servicio
            try {
                JsonNode root = mapper.readTree(raw);
                JsonNode userInfo = root.path("user_info");
                String status = userInfo.path("status").asText("Unknown");
                String expDate = userInfo.path("exp_date").asText(null);
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
            } catch (Exception ignored) { /* si el JSON es inesperado, no falla */ }

            config.setConnected(true);
            return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(raw);

        } catch (Exception e) {
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

    /**
     * Lista de categorías de canales en vivo (JSON array del proveedor).
     */
    @GetMapping(value = "/categories", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> categories() {
        if (!config.isConnected()) {
            return ResponseEntity.status(401)
                    .body("{\"error\":\"Proveedor no conectado\"}");
        }
        try {
            return ResponseEntity.ok()
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(iptvService.getLiveCategories());
        } catch (Exception e) {
            return ResponseEntity.status(502)
                    .body("{\"error\":\"" + escapeJson(e.getMessage()) + "\"}");
        }
    }

    /**
     * Canales en vivo, opcionalmente filtrados por categoría.
     * ?category_id=N
     */
    @GetMapping(value = "/streams", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> streams(
            @RequestParam(value = "category_id", required = false) String categoryId) {
        if (!config.isConnected()) {
            return ResponseEntity.status(401)
                    .body("{\"error\":\"Proveedor no conectado\"}");
        }
        try {
            return ResponseEntity.ok()
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(iptvService.getLiveStreams(categoryId));
        } catch (Exception e) {
            return ResponseEntity.status(502)
                    .body("{\"error\":\"" + escapeJson(e.getMessage()) + "\"}");
        }
    }

    private String escapeJson(String s) {
        if (s == null) return "Error desconocido";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
