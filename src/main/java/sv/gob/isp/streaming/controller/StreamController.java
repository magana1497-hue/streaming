package sv.gob.isp.streaming.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import sv.gob.isp.streaming.service.BroadcastService;

@Controller
public class StreamController {

    @Autowired
    private BroadcastService broadcastService;

    @GetMapping("/admin")
    public String admin(Model model) {
        model.addAttribute("viewerCount", broadcastService.getViewerCount());
        return "admin";
    }

    @GetMapping("/ver")
    public String viewer() {
        return "ver";
    }

    @GetMapping("/login")
    public String login() {
        return "login";
    }
}
