import type { CapacitorConfig } from '@capacitor/cli'

// appId is reverse-DNS for openvoyage.app; Android treats it as the
// permanent package identity, so changing it later makes a new app to
// users/app stores rather than updating this one.
const config: CapacitorConfig = {
  appId: 'app.openvoyage',
  appName: 'OpenVoyage',
  webDir: 'dist',
  android: {
    // The webview itself always loads over https://localhost (Capacitor's
    // own scheme), so a plain-HTTP server address (self-hosted on a home
    // LAN with no TLS terminator, see src/native/server-config.ts) counts
    // as mixed content from that secure origin's point of view. Without
    // this, fetch() calls to an HTTP server are blocked identically to the
    // OS-level cleartext block that network_security_config.xml lifts.
    allowMixedContent: true,
  },
}

export default config
