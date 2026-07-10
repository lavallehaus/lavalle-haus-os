// api/google-auth.js — Lavalle Haus OS
// Kicks off the Google OAuth flow: redirects the user to Google's consent
// screen requesting the minimal drive.file scope. After they approve, Google
// sends them to /api/google-callback with an authorization code.
//
// Needs GOOGLE_CLIENT_ID set in Vercel env vars.

const REDIRECT = "https://lavalle-haus-os.vercel.app/api/google-callback";
// drive.file = statement uploads; drive.readonly = listing the Grid-planner
// photo folders she shares. Reconnecting once re-consents to both.
const SCOPE = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly";

export default function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    res.status(500).send("GOOGLE_CLIENT_ID is not set in Vercel environment variables.");
    return;
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",      // ask for a refresh token
    prompt: "consent",           // force refresh token to be returned
    include_granted_scopes: "true",
  });
  res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
  res.end();
}
