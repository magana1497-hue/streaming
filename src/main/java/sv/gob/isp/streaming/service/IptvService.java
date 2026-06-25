package sv.gob.isp.streaming.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import javax.annotation.PostConstruct;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.SocketTimeoutException;

@Service
public class IptvService {

    private static final String USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ISPStreaming/1.0";

    @Autowired
    private IptvConfigService config;

    @Value("${app.iptv.proxy.host:}")
    private String proxyHost;

    @Value("${app.iptv.proxy.port:3128}")
    private int proxyPort;

    @Value("${app.iptv.timeout.connect:15000}")
    private int connectTimeout;

    @Value("${app.iptv.timeout.read:30000}")
    private int readTimeout;

    private RestTemplate restTemplate;

    @PostConstruct
    private void init() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(connectTimeout);
        factory.setReadTimeout(readTimeout);
        if (proxyHost != null && !proxyHost.isBlank()) {
            Proxy proxy = new Proxy(Proxy.Type.HTTP, new InetSocketAddress(proxyHost, proxyPort));
            factory.setProxy(proxy);
        }
        restTemplate = new RestTemplate(factory);
    }

    /** Prueba la conexión. Devuelve el JSON crudo de user_info + server_info. */
    public String testConnection() {
        requireConfigured();
        return get(config.buildApiUrl(null, null));
    }

    /** Lista de categorías live (JSON array). */
    public String getLiveCategories() {
        requireConfigured();
        return get(config.buildApiUrl("get_live_categories", null));
    }

    /** Lista de canales live, opcionalmente filtrados por categoría (JSON array). */
    public String getLiveStreams(String categoryId) {
        requireConfigured();
        String extra = (categoryId != null && !categoryId.isBlank())
                ? "category_id=" + categoryId : null;
        return get(config.buildApiUrl("get_live_streams", extra));
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private String get(String url) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("User-Agent", USER_AGENT);
        HttpEntity<Void> entity = new HttpEntity<>(headers);
        try {
            ResponseEntity<String> response =
                    restTemplate.exchange(url, HttpMethod.GET, entity, String.class);
            if (!response.getStatusCode().is2xxSuccessful()) {
                throw new RuntimeException("El proveedor respondió con HTTP " + response.getStatusCodeValue());
            }
            return response.getBody();
        } catch (ResourceAccessException e) {
            throw new RuntimeException(friendlyNetworkError(e), e);
        } catch (RestClientException e) {
            throw new RuntimeException("Error al comunicarse con el proveedor: " + e.getMessage(), e);
        }
    }

    /** Convierte excepciones de red en mensajes legibles para el administrador. */
    private String friendlyNetworkError(ResourceAccessException e) {
        Throwable cause = e.getCause();
        if (cause instanceof SocketTimeoutException) {
            String msg = cause.getMessage() != null ? cause.getMessage().toLowerCase() : "";
            if (msg.contains("connect")) {
                return "No se pudo conectar con el servidor IPTV (connect timed out). "
                     + "Verifique que la URL sea correcta y que el puerto sea accesible desde esta red. "
                     + (proxyHost.isBlank()
                        ? "Si su red requiere un proxy HTTP, configúrelo en app.iptv.proxy.host/port."
                        : "Proxy configurado: " + proxyHost + ":" + proxyPort + " — verifique que esté activo.");
            }
            return "Tiempo de espera agotado al leer la respuesta del servidor IPTV.";
        }
        if (cause instanceof java.net.ConnectException) {
            return "Conexión rechazada por el servidor IPTV. Verifique el puerto.";
        }
        if (cause instanceof java.net.UnknownHostException) {
            return "No se pudo resolver el nombre del servidor IPTV. Verifique la URL.";
        }
        return "Error de red: " + (cause != null ? cause.getMessage() : e.getMessage());
    }

    private void requireConfigured() {
        if (!config.isConfigured()) {
            throw new IllegalStateException("Proveedor IPTV no configurado");
        }
    }
}
