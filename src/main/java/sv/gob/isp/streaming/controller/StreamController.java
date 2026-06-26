package sv.gob.isp.streaming.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import sv.gob.isp.streaming.service.BroadcastService;
import sv.gob.isp.streaming.service.IptvConfigService;

@Controller
public class StreamController {

    @Autowired
    private BroadcastService broadcastService;

    @Autowired
    private IptvConfigService iptvConfigService;

    @GetMapping("/admin")
    public String admin(Model model) {
        model.addAttribute("viewerCount", broadcastService.getViewerCount());
        model.addAttribute("iptvServer",   iptvConfigService.getServerUrl()   != null ? iptvConfigService.getServerUrl()   : "");
        model.addAttribute("iptvUsername", iptvConfigService.getUsername()    != null ? iptvConfigService.getUsername()    : "");
        model.addAttribute("iptvPassword", iptvConfigService.getPassword()    != null ? iptvConfigService.getPassword()    : "");
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
