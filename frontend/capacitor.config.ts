import type { CapacitorConfig } from '@capacitor/cli'

// appId is reverse-DNS for openvoyage.app; Android treats it as the
// permanent package identity, so changing it later makes a new app to
// users/app stores rather than updating this one.
const config: CapacitorConfig = {
  appId: 'app.openvoyage',
  appName: 'OpenVoyage',
  webDir: 'dist',
  server: {
    // A self-hosted server address (home LAN, no TLS terminator, see
    // src/native/server-config.ts) is plain HTTP. Serving the webview
    // itself over Capacitor's default https://localhost would make every
    // request to that server "mixed content": fetch()/XHR can be forced
    // through with android.allowMixedContent, but Chromium auto-upgrades
    // <img>/<video> mixed-content requests to https and hard-blocks them
    // if that upgrade fails (which it always does here, since the server
    // has no TLS) — no WebView setting can override that for images.
    // Serving the webview over http://localhost instead means same-scheme
    // requests to an http server are never "mixed content" in the first
    // place, so images load like any other resource.
    androidScheme: 'http',
  },
  android: {
    // Belt-and-suspenders alongside androidScheme above, in case any
    // request is ever made from an https context (e.g. a future iOS-style
    // config, or a stray absolute https:// asset URL).
    allowMixedContent: true,
  },
  plugins: {
    // The webview has its own http://localhost origin, while a self-hosted
    // server can live at any address. Route fetch/XHR through Android's
    // native HTTP stack so these requests are not subject to WebView CORS.
    // This preserves a server's browser CORS allow-list and also supports
    // multipart uploads through the patched fetch implementation.
    CapacitorHttp: {
      enabled: true,
    },
  },
}

export default config
