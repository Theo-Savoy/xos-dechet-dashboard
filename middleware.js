// Auth par cookie xos_auth sur les routes legacy (dashboard.html et /api/*).
// Route / (racine exacte) et /assets/* /fonts/* /favicon* sont publiques :
//   la SPA charge et LoginScreen gère Google SSO avec PKCE.
// Le cookie xos_auth est posé soit par POST /login (Basic Auth),
//   soit par /api/sso-bridge (vérification JWT Supabase → cookie legacy).
// /api/sso-bridge est public : il porte son propre JWT en Authorization header.

export const config = { matcher: "/(.*)" };

const LOGIN_HTML = `<!doctype html><html lang="fr"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>XOS — Connexion</title>
<body style="margin:0;font-family:system-ui,sans-serif;background:#0f1115;color:#e6e6e6;display:flex;justify-content:center;align-items:center;height:100vh">
<div style="text-align:center;background:#181b22;padding:32px 40px;border-radius:12px;border:1px solid #2a2f3a;max-width:360px;width:100%">
<h2 style="margin-top:0">🗑️ Dashboard XOS Déchet</h2>
<form method="POST" action="/login" style="margin-bottom:24px">
<input type="password" name="password" placeholder="Mot de passe" autofocus required
  style="padding:10px;border-radius:8px;border:1px solid #2a2f3a;background:#0f1115;color:#e6e6e6;width:100%;box-sizing:border-box">
<button style="margin-top:12px;padding:10px;border-radius:8px;border:none;background:#3b82f6;color:#fff;cursor:pointer;width:100%;box-sizing:border-box;font-size:14px">Entrer</button>
</form>
<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;color:#555">
<div style="flex:1;height:1px;background:#2a2f3a"></div><span>ou</span><div style="flex:1;height:1px;background:#2a2f3a"></div>
</div>
<a href="/" style="display:block;padding:10px;border-radius:8px;background:#fff;color:#333;text-decoration:none;font-weight:600;font-size:14px">Se connecter avec Google</a>
<p style="margin-top:16px;font-size:12px;color:#555">Comptes <strong>@xos-learning.fr</strong> uniquement</p>
</div></body></html>`;

function loginPage(status) {
  return new Response(LOGIN_HTML, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// Routes publiques (SPA statique, pas de données protégées)
function isPublic(pathname) {
  if (pathname === "/") return true;
  if (pathname.startsWith("/assets/")) return true;
  if (pathname.startsWith("/fonts/")) return true;
  if (pathname.startsWith("/favicon")) return true;
  return false;
}

// Routes protégées par le cookie xos_auth
function isProtected(pathname) {
  if (pathname === "/dashboard.html") return true;
  if (pathname.startsWith("/api/")) return true;
  return false;
}

export default async function middleware(request) {
  const password = process.env.DASHBOARD_PASSWORD;
  const url = new URL(request.url);
  const pathname = url.pathname;

  // POST /login → Basic Auth form submission
  if (pathname === "/login" && request.method === "POST") {
    const form = await request.formData();
    if (password && form.get("password") === password) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: "/",
          "Set-Cookie": `xos_auth=${password}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
        },
      });
    }
    return loginPage(401);
  }

  // /api/sso-bridge porte son propre JWT, pas besoin de cookie
  if (pathname === "/api/sso-bridge") {
    return; // laisser passer — l'endpoint gère sa propre auth
  }

  // Routes publiques : SPA + assets
  if (isPublic(pathname)) {
    return;
  }

  // Routes protégées : vérifier le cookie xos_auth
  if (isProtected(pathname)) {
    const cookieHeader = request.headers.get("cookie") || "";
    if (password && cookieHeader.split(/;\s*/).includes("xos_auth=" + password)) {
      return;
    }
    return loginPage(401);
  }

  // Tout le reste → login
  return loginPage(401);
}
