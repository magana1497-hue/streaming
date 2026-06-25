package sv.gob.isp.streaming.ws;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import sv.gob.isp.streaming.service.BroadcastService;

import java.util.HashMap;
import java.util.Map;

@Component
public class SignalingHandler extends TextWebSocketHandler {

    @Autowired
    private BroadcastService broadcastService;

    private final ObjectMapper mapper = new ObjectMapper();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        String role = getQueryParam(session, "role");

        if ("admin".equals(role)) {
            WebSocketSession oldAdmin = broadcastService.getAdminSession();
            if (oldAdmin != null && oldAdmin.isOpen()) {
                oldAdmin.close();
            }
            broadcastService.setAdminSession(session);
            sendJson(session, map("type", "init", "viewerCount", broadcastService.getViewerCount()));
        } else {
            // Viewer
            broadcastService.addViewer(session);
            WebSocketSession admin = broadcastService.getAdminSession();
            if (admin != null && admin.isOpen()) {
                sendJson(admin, map("type", "viewer-joined",
                        "viewerId", session.getId(),
                        "viewerCount", broadcastService.getViewerCount()));
            }
            // Inform new viewer of current broadcast state
            BroadcastService.Mode mode = broadcastService.getCurrentMode();
            if (mode == BroadcastService.Mode.URL) {
                sendJson(session, map("type", "mode", "mode", "url", "src", broadcastService.getCurrentUrl()));
            } else if (mode == BroadcastService.Mode.LIVE) {
                sendJson(session, map("type", "mode", "mode", "live"));
                // Admin will react to viewer-joined above and create offer
            }
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        Map<String, Object> msg = mapper.readValue(message.getPayload(), new TypeReference<Map<String, Object>>() {});
        String type = (String) msg.get("type");

        if (type == null) return;

        switch (type) {
            case "mode":
                handleModeChange(msg);
                break;
            case "offer":
            case "answer":
            case "ice":
                relayMessage(session, msg);
                break;
            case "stop":
                handleStop();
                break;
            default:
                break;
        }
    }

    private void handleModeChange(Map<String, Object> msg) throws Exception {
        String mode = (String) msg.get("mode");
        WebSocketSession admin = broadcastService.getAdminSession();

        if ("url".equals(mode)) {
            String src = (String) msg.get("src");
            broadcastService.setCurrentMode(BroadcastService.Mode.URL);
            broadcastService.setCurrentUrl(src);
            for (WebSocketSession viewer : broadcastService.getViewers()) {
                if (viewer.isOpen()) {
                    sendJson(viewer, map("type", "mode", "mode", "url", "src", src));
                }
            }

        } else if ("live".equals(mode)) {
            broadcastService.setCurrentMode(BroadcastService.Mode.LIVE);
            broadcastService.setCurrentUrl(null);
            // Notify viewers to prepare, then ask admin to create offer per viewer
            for (WebSocketSession viewer : broadcastService.getViewers()) {
                if (viewer.isOpen()) {
                    sendJson(viewer, map("type", "mode", "mode", "live"));
                }
            }
            for (WebSocketSession viewer : broadcastService.getViewers()) {
                if (viewer.isOpen() && admin != null && admin.isOpen()) {
                    sendJson(admin, map("type", "viewer-joined",
                            "viewerId", viewer.getId(),
                            "viewerCount", broadcastService.getViewerCount()));
                }
            }

        } else if ("off".equals(mode)) {
            handleStop();
        }
    }

    private void relayMessage(WebSocketSession sender, Map<String, Object> msg) throws Exception {
        WebSocketSession admin = broadcastService.getAdminSession();
        boolean senderIsAdmin = admin != null && admin.getId().equals(sender.getId());

        if (senderIsAdmin) {
            // Admin -> specific viewer
            String target = (String) msg.get("target");
            WebSocketSession viewer = broadcastService.getViewer(target);
            if (viewer != null && viewer.isOpen()) {
                msg.put("from", sender.getId());
                sendJson(viewer, msg);
            }
        } else {
            // Viewer -> admin
            if (admin != null && admin.isOpen()) {
                msg.put("from", sender.getId());
                sendJson(admin, msg);
            }
        }
    }

    private void handleStop() throws Exception {
        broadcastService.setCurrentMode(BroadcastService.Mode.OFF);
        broadcastService.setCurrentUrl(null);
        for (WebSocketSession viewer : broadcastService.getViewers()) {
            if (viewer.isOpen()) {
                sendJson(viewer, map("type", "stop"));
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        WebSocketSession admin = broadcastService.getAdminSession();
        if (admin != null && admin.getId().equals(session.getId())) {
            broadcastService.removeAdminSession();
            for (WebSocketSession viewer : broadcastService.getViewers()) {
                if (viewer.isOpen()) {
                    sendJson(viewer, map("type", "stop"));
                }
            }
        } else {
            broadcastService.removeViewer(session.getId());
            if (admin != null && admin.isOpen()) {
                sendJson(admin, map("type", "viewer-left",
                        "viewerId", session.getId(),
                        "viewerCount", broadcastService.getViewerCount()));
            }
        }
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) throws Exception {
        if (session.isOpen()) {
            session.close(CloseStatus.SERVER_ERROR);
        }
    }

    // Thread-safe send
    private void sendJson(WebSocketSession session, Map<String, Object> data) throws Exception {
        synchronized (session) {
            if (session.isOpen()) {
                session.sendMessage(new TextMessage(mapper.writeValueAsString(data)));
            }
        }
    }

    // Convenience builder for small maps
    private Map<String, Object> map(Object... kv) {
        Map<String, Object> m = new HashMap<>();
        for (int i = 0; i < kv.length - 1; i += 2) {
            m.put((String) kv[i], kv[i + 1]);
        }
        return m;
    }

    private String getQueryParam(WebSocketSession session, String param) {
        String query = session.getUri() != null ? session.getUri().getQuery() : null;
        if (query == null) return null;
        for (String part : query.split("&")) {
            String[] kv = part.split("=", 2);
            if (kv.length == 2 && kv[0].equals(param)) return kv[1];
        }
        return null;
    }
}
