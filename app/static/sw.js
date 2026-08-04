/*
 * Service Worker — Handles Push Notifications via Pusher Beams
 * ═══════════════════════════════════════════════════════════════
 *
 * This service worker runs in the background, even when the tab is closed.
 * It receives push notifications from Pusher Beams and shows them to the user.
 *
 * WHAT IT DOES:
 *   1. Receives push events from Pusher Beams
 *   2. Shows a native browser notification
 *   3. Handles notification click — opens/focuses the chat page
 *
 * REGISTRATION:
 *   Registered in chat.html after login.
 *   Must be at the root or a parent directory of the pages it controls.
 */

// Import Pusher Beams service worker library
importScripts("https://js.pusher.com/beams/service-worker.js");

/*
 * Handle notification click
 * When user clicks the notification, open or focus the chat page
 */
self.addEventListener("notificationclick", (event) => {
  // Close the notification
  event.notification.close();

  // Get the data sent with the notification
  const data = event.notification.data || {};

  // Determine which URL to open
  let url = "/chat";
  if (data.type === "new_message" && data.sender_id) {
    url = `/chat?user=${data.sender_id}`;
  }

  // Open or focus the chat page
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // Check if chat page is already open
      for (const client of windowClients) {
        if (client.url.includes("/chat") && "focus" in client) {
          // Focus the existing chat tab
          return client.focus();
        }
      }
      // Otherwise, open a new chat tab
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
