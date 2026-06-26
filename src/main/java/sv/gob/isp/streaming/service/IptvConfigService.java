package sv.gob.isp.streaming.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.annotation.PostConstruct;

@Service
public class IptvConfigService {

    @Value("${app.iptv.default.server:}")
    private String defaultServer;

    @Value("${app.iptv.default.username:}")
    private String defaultUsername;

    @Value("${app.iptv.default.password:}")
    private String defaultPassword;

    private volatile String serverUrl;
    private volatile String username;
    private volatile String password;
    private volatile boolean connected;
    private volatile String accountStatus;
    private volatile String accountExpiry;

    @PostConstruct
    private void loadDefaults() {
        if (defaultServer != null && !defaultServer.isBlank()
                && defaultUsername != null && !defaultUsername.isBlank()
                && defaultPassword != null && !defaultPassword.isBlank()) {
            configure(defaultServer, defaultUsername, defaultPassword);
        }
    }

    /** Guarda credenciales normalizando la URL base (sin / final, con scheme). */
    public synchronized void configure(String serverUrl, String username, String password) {
        String url = serverUrl != null ? serverUrl.trim() : "";
        if (!url.isEmpty() && !url.startsWith("http://") && !url.startsWith("https://")) {
            url = "http://" + url;
        }
        this.serverUrl = url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
        this.username = username;
        this.password = password;
        this.connected = false;
        this.accountStatus = null;
        this.accountExpiry = null;
    }

    public boolean isConfigured() {
        return serverUrl != null && username != null && password != null
                && !serverUrl.isBlank() && !username.isBlank() && !password.isBlank();
    }

    /** Construye URL de la API Xtream. action=null para login/test. */
    public String buildApiUrl(String action, String extraParams) {
        StringBuilder sb = new StringBuilder(serverUrl)
                .append("/player_api.php?username=").append(encode(username))
                .append("&password=").append(encode(password));
        if (action != null && !action.isBlank()) sb.append("&action=").append(action);
        if (extraParams != null && !extraParams.isBlank()) sb.append("&").append(extraParams);
        return sb.toString();
    }

    /** URL de stream HLS: {server}/live/{user}/{pass}/{streamId}.m3u8 */
    public String buildStreamUrl(String streamId) {
        return serverUrl + "/live/" + encode(username) + "/" + encode(password)
                + "/" + streamId + ".m3u8";
    }

    // ── Getters / setters ────────────────────────────────────────────────────

    public String getServerUrl()   { return serverUrl; }
    public String getUsername()    { return username; }
    public String getPassword()    { return password; }
    public boolean isConnected()   { return connected; }
    public String getAccountStatus()  { return accountStatus; }
    public String getAccountExpiry()  { return accountExpiry; }

    public void setConnected(boolean connected)       { this.connected = connected; }
    public void setAccountStatus(String status)       { this.accountStatus = status; }
    public void setAccountExpiry(String expiry)       { this.accountExpiry = expiry; }

    // Simple percent-encoding for username/password in URLs (handles spaces, special chars)
    private String encode(String value) {
        if (value == null) return "";
        try {
            return java.net.URLEncoder.encode(value, "UTF-8");
        } catch (java.io.UnsupportedEncodingException e) {
            return value;
        }
    }
}
