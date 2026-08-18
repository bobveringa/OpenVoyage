package app.openvoyage;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Capacitor's own local-server routing only falls back to index.html for a
 * hard navigation when the last path segment has no ".", so any client-side
 * route ending in a dotted segment (e.g. /users/henk.de.steen for a username
 * containing a dot) fails on refresh/deep-link. Worse, for that case
 * Capacitor doesn't return null when the path isn't a real asset - it
 * returns a WebResourceResponse wrapping a stream that fails to open, which
 * the WebView rejects as net::ERR_INVALID_RESPONSE rather than surfacing as
 * "not found". So its return value can't be used to detect the unmatched
 * case; this checks asset existence itself before ever calling super().
 */
public class SpaFallbackWebViewClient extends BridgeWebViewClient {

    private final Bridge bridge;

    public SpaFallbackWebViewClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        if (isUnresolvedSpaNavigation(request)) {
            WebResourceResponse fallback = serveIndexHtml();
            if (fallback != null) {
                return fallback;
            }
        }
        return super.shouldInterceptRequest(view, request);
    }

    // True only for a main-frame navigation on our own bundled origin, whose
    // path Capacitor's own html5mode check would skip (last segment has a
    // ".") and which isn't a real asset in the app bundle either.
    private boolean isUnresolvedSpaNavigation(WebResourceRequest request) {
        if (!request.isForMainFrame() || !"GET".equalsIgnoreCase(request.getMethod())) {
            return false;
        }

        Uri url = request.getUrl();
        boolean isOwnOrigin = bridge.getServerUrl() == null && url.getHost().equalsIgnoreCase(bridge.getHost());
        if (!isOwnOrigin) {
            return false;
        }

        String path = url.getPath();
        if (path == null || path.equals("/")) {
            return false;
        }

        String lastSegment = path.substring(path.lastIndexOf('/') + 1);
        if (!lastSegment.contains(".")) {
            return false;
        }

        return !assetExists("public" + path);
    }

    private boolean assetExists(String assetPath) {
        try (InputStream stream = bridge.getContext().getAssets().open(assetPath)) {
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    private WebResourceResponse serveIndexHtml() {
        try {
            InputStream indexHtml = bridge.getContext().getAssets().open("public/index.html");
            // The 3-arg WebResourceResponse constructor leaves the status code
            // at 0, which newer WebView builds reject outright with
            // net::ERR_INVALID_RESPONSE instead of rendering the body - the
            // status/reason/headers must be set explicitly.
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-cache");
            return new WebResourceResponse("text/html", "UTF-8", 200, "OK", headers, indexHtml);
        } catch (IOException e) {
            return null;
        }
    }
}
