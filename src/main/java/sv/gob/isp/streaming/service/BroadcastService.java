package sv.gob.isp.streaming.service;

import org.springframework.stereotype.Service;
import org.springframework.web.socket.WebSocketSession;

import java.util.Collection;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class BroadcastService {

    public enum Mode { OFF, URL, LIVE }

    private volatile WebSocketSession adminSession;
    private final ConcurrentHashMap<String, WebSocketSession> viewerSessions = new ConcurrentHashMap<>();
    private volatile Mode currentMode = Mode.OFF;
    private volatile String currentUrl;

    public void setAdminSession(WebSocketSession session) {
        this.adminSession = session;
    }

    public WebSocketSession getAdminSession() {
        return adminSession;
    }

    public void removeAdminSession() {
        adminSession = null;
        currentMode = Mode.OFF;
        currentUrl = null;
    }

    public void addViewer(WebSocketSession session) {
        viewerSessions.put(session.getId(), session);
    }

    public void removeViewer(String sessionId) {
        viewerSessions.remove(sessionId);
    }

    public Collection<WebSocketSession> getViewers() {
        return viewerSessions.values();
    }

    public WebSocketSession getViewer(String sessionId) {
        return viewerSessions.get(sessionId);
    }

    public int getViewerCount() {
        return viewerSessions.size();
    }

    public Mode getCurrentMode() {
        return currentMode;
    }

    public void setCurrentMode(Mode mode) {
        this.currentMode = mode;
    }

    public String getCurrentUrl() {
        return currentUrl;
    }

    public void setCurrentUrl(String url) {
        this.currentUrl = url;
    }
}
