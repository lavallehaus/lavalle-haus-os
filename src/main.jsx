import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Installable-app support: register the (passthrough) service worker.
if ("serviceWorker" in navigator) {
  // The PWA service worker went stale in the field and hung every fetch —
  // the app now runs without one, and this actively removes any leftover.
  window.addEventListener("load", () => { navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {}); });
}
