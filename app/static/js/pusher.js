/**
 * Pusher Beams — Client-Side Push Notification Subscription
 * ═══════════════════════════════════════════════════════════════
 *
 * Uses Pusher Beams SDK built-in TokenProvider for authenticated users.
 * Server endpoint returns { token: "jwt-string" } which the SDK fetches automatically.
 */

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    console.log("Pusher Beams: Service workers not supported");
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    console.log("Pusher Beams: Service worker registered", registration.scope);
    return registration;
  } catch (err) {
    console.error("Pusher Beams: Service worker registration failed", err);
    return null;
  }
}

async function getBeamsConfig() {
  try {
    const res = await fetch("/api/chat/beams-config", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("Pusher Beams: Failed to get config", err);
    return null;
  }
}

async function subscribeToPush() {
  if (!me || !me.id) {
    console.log("Pusher Beams: No user logged in, skipping");
    return;
  }

  const registration = await registerServiceWorker();
  if (!registration) {
    console.log("Pusher Beams: No service worker, skipping");
    return;
  }

  const config = await getBeamsConfig();
  if (!config || !config.instance_id) {
    console.log("Pusher Beams: No instance ID configured, skipping");
    return;
  }

  try {
    const beamsClient = new PusherPushNotifications.Client({
      instanceId: config.instance_id,
      serviceWorkerRegistration: registration,
    });

    await beamsClient.start();
    console.log("Pusher Beams: Device registered");

    const tokenProvider = new PusherPushNotifications.TokenProvider({
      url: "/api/chat/beams-token",
      headers: { Authorization: `Bearer ${token}` },
    });

    await beamsClient.setUserId(`user_${me.id}`, tokenProvider);
    console.log(`Pusher Beams: Authenticated as user_${me.id}`);

  } catch (err) {
    console.error("Pusher Beams: Subscription failed", err);
  }
}

subscribeToPush();
