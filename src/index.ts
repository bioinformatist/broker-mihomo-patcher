import { BROKER_PACKS, type BrokerPackId, isBrokerPackId } from "./rules";
import { PatchError, chooseDefaultPolicy, extractPolicyGroups, patchConfig } from "./patch";

interface Env {
  BROKER_PATCHER_KV: KVNamespace;
}

interface StoredProfile {
  upstreamUrl: string;
  brokerPacks: BrokerPackId[];
  targetPolicy: string;
  subToken: string;
  adminTokenHash: string;
  createdAt: string;
  updatedAt: string;
}

interface ProfileInput {
  upstreamUrl: string;
  brokerPacks: BrokerPackId[];
  targetPolicy: string;
}

const PROFILE_KEY = "profile:v1";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      return errorResponse(error);
    }
  },
} satisfies ExportedHandler<Env>;

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/favicon.ico") {
    return new Response(null, { status: 204 });
  }

  if (request.method === "GET" && url.pathname === "/") {
    const configured = (await getProfile(env)) !== null;
    return htmlResponse(renderAppHtml(configured));
  }

  if (request.method === "POST" && url.pathname === "/inspect") {
    return handleInspect(request);
  }

  if (request.method === "POST" && url.pathname === "/setup") {
    return handleSetup(request, env, url.origin);
  }

  if (request.method === "GET" && url.pathname === "/profile") {
    return handleGetProfile(request, env, url.origin);
  }

  if (request.method === "POST" && url.pathname === "/profile") {
    return handleUpdateProfile(request, env, url.origin);
  }

  if (request.method === "GET" && url.pathname.startsWith("/sub/")) {
    const subToken = decodeURIComponent(url.pathname.slice("/sub/".length));
    return handleSubscription(env, subToken);
  }

  return new Response("Not found", { status: 404 });
}

async function handleInspect(request: Request): Promise<Response> {
  const input = parseInspectInput(await readJson(request));
  const upstreamText = await fetchUpstreamConfig(input.upstreamUrl);
  const policyGroups = extractPolicyGroups(upstreamText);

  return jsonResponse({
    policyGroups,
    defaultPolicy: chooseDefaultPolicy(policyGroups),
  });
}

async function handleSetup(request: Request, env: Env, origin: string): Promise<Response> {
  if ((await getProfile(env)) !== null) {
    throw new HttpError(409, "This Worker has already been configured.");
  }

  const input = parseProfileInput(await readJson(request));
  const upstreamText = await fetchUpstreamConfig(input.upstreamUrl);
  const policyGroups = extractPolicyGroups(upstreamText);
  patchConfig(upstreamText, input);

  const subToken = generateToken();
  const adminToken = generateToken();
  const now = new Date().toISOString();
  const profile: StoredProfile = {
    ...input,
    subToken,
    adminTokenHash: await hashToken(adminToken),
    createdAt: now,
    updatedAt: now,
  };

  await putProfile(env, profile);

  return jsonResponse({
    profile: publicProfile(profile, policyGroups),
    subscriptionUrl: subscriptionUrl(origin, subToken),
    adminUrl: adminUrl(origin, adminToken),
    adminToken,
  });
}

async function handleGetProfile(request: Request, env: Env, origin: string): Promise<Response> {
  const profile = await requireAuthorizedProfile(request, env);

  return jsonResponse({
    profile: publicProfile(profile, []),
    subscriptionUrl: subscriptionUrlForProfile(origin, profile),
  });
}

async function handleUpdateProfile(request: Request, env: Env, origin: string): Promise<Response> {
  const profile = await requireAuthorizedProfile(request, env);
  const input = parseProfileInput(await readJson(request));
  const upstreamText = await fetchUpstreamConfig(input.upstreamUrl);
  const policyGroups = extractPolicyGroups(upstreamText);
  patchConfig(upstreamText, input);

  const updatedProfile: StoredProfile = {
    ...profile,
    ...input,
    updatedAt: new Date().toISOString(),
  };

  await putProfile(env, updatedProfile);

  return jsonResponse({
    profile: publicProfile(updatedProfile, policyGroups),
    subscriptionUrl: subscriptionUrlForProfile(origin, updatedProfile),
  });
}

async function handleSubscription(env: Env, subToken: string): Promise<Response> {
  const profile = await getProfile(env);
  if (!profile) {
    throw new HttpError(404, "This Worker has not been configured yet.");
  }

  if (subToken !== profile.subToken) {
    throw new HttpError(404, "Subscription not found.");
  }

  const upstreamText = await fetchUpstreamConfig(profile.upstreamUrl);
  const patched = patchConfig(upstreamText, profile);

  return new Response(patched, {
    headers: {
      "content-type": "text/yaml; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function requireAuthorizedProfile(request: Request, env: Env): Promise<StoredProfile> {
  const profile = await getProfile(env);
  if (!profile) {
    throw new HttpError(404, "This Worker has not been configured yet.");
  }

  const token = getBearerToken(request);
  if (!token || !(await verifyToken(token, profile.adminTokenHash))) {
    throw new HttpError(401, "Invalid management link.");
  }

  return profile;
}

async function getProfile(env: Env): Promise<StoredProfile | null> {
  const raw = await env.BROKER_PATCHER_KV.get(PROFILE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as StoredProfile;
  } catch {
    throw new HttpError(500, "Stored profile is corrupted.");
  }
}

async function putProfile(env: Env, profile: StoredProfile): Promise<void> {
  await env.BROKER_PATCHER_KV.put(PROFILE_KEY, JSON.stringify(profile));
}

function parseInspectInput(input: unknown): { upstreamUrl: string } {
  const body = requireRecord(input);
  const upstreamUrl = readRequiredString(body, "upstreamUrl");
  validateUpstreamUrl(upstreamUrl);
  return { upstreamUrl };
}

function parseProfileInput(input: unknown): ProfileInput {
  const body = requireRecord(input);
  const upstreamUrl = readRequiredString(body, "upstreamUrl");
  const targetPolicy = readRequiredString(body, "targetPolicy");

  validateUpstreamUrl(upstreamUrl);
  if (/[\r\n,]/.test(targetPolicy)) {
    throw new HttpError(400, "Target policy cannot contain commas or line breaks.");
  }

  if (!Array.isArray(body.brokerPacks)) {
    throw new HttpError(400, "Select at least one broker pack.");
  }

  const brokerPacks = [...new Set(body.brokerPacks)]
    .filter((value): value is string => typeof value === "string")
    .filter(isBrokerPackId);

  if (brokerPacks.length === 0) {
    throw new HttpError(400, "Select at least one broker pack.");
  }

  return { upstreamUrl, brokerPacks, targetPolicy };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Expected a JSON object.");
  }

  return value as Record<string, unknown>;
}

function readRequiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${key} is required.`);
  }

  return value.trim();
}

function validateUpstreamUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, "Upstream subscription URL is invalid.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new HttpError(400, "Upstream subscription URL must use http or https.");
  }
}

async function fetchUpstreamConfig(upstreamUrl: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(upstreamUrl, {
      headers: {
        accept: "text/yaml, application/yaml, text/plain, */*",
      },
    });
  } catch (error) {
    const reason = error instanceof Error && error.message ? `: ${error.message}` : ".";
    throw new HttpError(502, `Failed to fetch the upstream subscription${reason}`);
  }

  if (!response.ok) {
    throw new HttpError(502, `Upstream subscription returned HTTP ${response.status}.`);
  }

  const text = await response.text();
  if (!text.trim()) {
    throw new HttpError(502, "Upstream subscription returned an empty response.");
  }

  return text;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Expected a JSON request body.");
  }
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

function publicProfile(profile: StoredProfile, policyGroups: string[]) {
  return {
    upstreamUrl: profile.upstreamUrl,
    brokerPacks: profile.brokerPacks,
    targetPolicy: profile.targetPolicy,
    policyGroups,
    updatedAt: profile.updatedAt,
  };
}

function subscriptionUrlForProfile(origin: string, profile: StoredProfile): string {
  return subscriptionUrl(origin, profile.subToken);
}

function subscriptionUrl(origin: string, subToken: string): string {
  return `${origin}/sub/${encodeURIComponent(subToken)}`;
}

function adminUrl(origin: string, adminToken: string): string {
  return `${origin}/#admin=${encodeURIComponent(adminToken)}`;
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return base64Url(new Uint8Array(digest));
}

async function verifyToken(token: string, expectedHash: string): Promise<boolean> {
  return (await hashToken(token)) === expectedHash;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      "cache-control": "no-store",
    },
  });
}

function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonResponse({ error: error.message }, error.status);
  }

  if (error instanceof PatchError) {
    return jsonResponse({ error: error.message }, 400);
  }

  return jsonResponse({ error: "Internal server error." }, 500);
}

function renderAppHtml(configured: boolean): string {
  const boot = escapeScriptJson(
    JSON.stringify({
      configured,
      packs: BROKER_PACKS.map(({ id, label }) => ({ id, label })),
    }),
  );

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Broker Mihomo Patcher</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f6f7f9;
        color: #20242c;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background: #f6f7f9;
      }

      main {
        width: min(760px, calc(100% - 32px));
        margin: 0 auto;
        padding: 40px 0;
      }

      h1 {
        margin: 0 0 8px;
        font-size: 28px;
        line-height: 1.15;
      }

      p {
        line-height: 1.55;
      }

      .panel {
        background: #ffffff;
        border: 1px solid #d8dde6;
        border-radius: 8px;
        padding: 24px;
        box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
      }

      .section {
        display: grid;
        gap: 16px;
        margin-top: 20px;
      }

      .field-with-action {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
        align-items: end;
      }

      label {
        display: grid;
        gap: 8px;
        font-weight: 650;
      }

      input[type="url"],
      input[type="text"],
      select {
        width: 100%;
        min-height: 42px;
        border: 1px solid #cbd2df;
        border-radius: 6px;
        padding: 9px 11px;
        font: inherit;
        background: #ffffff;
        color: #20242c;
      }

      input:focus,
      select:focus {
        outline: 2px solid #2563eb;
        outline-offset: 1px;
      }

      .checks {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .check {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 38px;
        padding: 8px 10px;
        border: 1px solid #cbd2df;
        border-radius: 6px;
        background: #ffffff;
        font-weight: 600;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 20px;
      }

      button {
        min-height: 40px;
        border: 1px solid #1e40af;
        border-radius: 6px;
        padding: 8px 12px;
        background: #1d4ed8;
        color: #ffffff;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }

      button.secondary {
        border-color: #cbd2df;
        background: #ffffff;
        color: #1f2937;
      }

      button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .message {
        min-height: 22px;
        margin-top: 14px;
        color: #465264;
      }

      .error {
        color: #b42318;
      }

      .success {
        color: #067647;
      }

      .links {
        display: grid;
        gap: 12px;
        margin-top: 20px;
      }

      .link-row {
        display: grid;
        gap: 8px;
      }

      .link-value {
        overflow-wrap: anywhere;
        border: 1px solid #d8dde6;
        border-radius: 6px;
        padding: 10px;
        background: #f9fafb;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 13px;
      }

      @media (prefers-color-scheme: dark) {
        :root,
        body {
          background: #111827;
          color: #e5e7eb;
        }

        .panel,
        input[type="url"],
        input[type="text"],
        select,
        .check,
        button.secondary {
          background: #1f2937;
          border-color: #374151;
          color: #e5e7eb;
        }

        .link-value {
          background: #111827;
          border-color: #374151;
        }

        .message {
          color: #aeb7c6;
        }
      }

      @media (max-width: 560px) {
        .field-with-action {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Broker Mihomo Patcher</h1>
      <div id="app" class="panel"></div>
    </main>
    <script>window.__BOOT__ = ${boot};</script>
    <script>${clientScript()}</script>
  </body>
</html>`;
}

function escapeScriptJson(value: string): string {
  return value.replaceAll("<", "\\u003c");
}

function clientScript(): string {
  return String.raw`
(function () {
  var boot = window.__BOOT__;
  var app = document.getElementById("app");
  var adminStorageKey = "brokerMihomoPatcher.adminToken";
  var state = { policyGroups: [] };

  function readAdminToken() {
    var params = new URLSearchParams(window.location.hash.slice(1));
    var fromHash = params.get("admin");
    if (fromHash) {
      window.localStorage.setItem(adminStorageKey, fromHash);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      return fromHash;
    }
    return window.localStorage.getItem(adminStorageKey);
  }

  function setHtml(html) {
    app.innerHTML = html;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char];
    });
  }

  function packCheckboxes(selected) {
    selected = selected || [];
    return '<div class="checks">' + boot.packs.map(function (pack) {
      var checked = selected.indexOf(pack.id) >= 0 ? " checked" : "";
      return '<label class="check"><input type="checkbox" name="brokerPacks" value="' + escapeHtml(pack.id) + '"' + checked + '> <span>' + escapeHtml(pack.label) + '</span></label>';
    }).join("") + '</div>';
  }

  function policyOptions(groups) {
    return (groups || []).map(function (name) {
      return '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>';
    }).join("");
  }

  function targetPolicyOptions(profile) {
    var groups = profile.policyGroups || state.policyGroups || [];
    var targetPolicy = profile.targetPolicy || "PROXY";
    var options = groups.slice();
    if (options.indexOf(targetPolicy) < 0) {
      options.unshift(targetPolicy);
    }
    return policyOptions(options);
  }

  function formHtml(profile) {
    profile = profile || {};
    var selected = profile.brokerPacks || ["futu"];
    var targetPolicy = profile.targetPolicy || "PROXY";
    var upstreamUrl = profile.upstreamUrl || "";
    return '' +
      '<form id="profileForm" class="section">' +
        '<div class="field-with-action">' +
          '<label>Upstream subscription URL' +
            '<input id="upstreamUrl" name="upstreamUrl" type="url" autocomplete="off" required value="' + escapeHtml(upstreamUrl) + '">' +
          '</label>' +
          '<button type="button" id="inspectButton" class="secondary" title="Fetch upstream and fill policy group suggestions without saving.">Check upstream</button>' +
        '</div>' +
        '<div>' +
          '<label>Broker packs</label>' +
          packCheckboxes(selected) +
        '</div>' +
        '<label>Target policy group' +
          '<select id="targetPolicy" name="targetPolicy" required>' + targetPolicyOptions(profile) + '</select>' +
        '</label>' +
        '<div class="actions">' +
          '<button type="submit" title="Validate and save this Worker profile.">Save profile</button>' +
        '</div>' +
        '<div id="message" class="message"></div>' +
      '</form>';
  }

  function collectForm() {
    var brokerPacks = Array.prototype.slice.call(document.querySelectorAll('input[name="brokerPacks"]:checked')).map(function (input) {
      return input.value;
    });
    return {
      upstreamUrl: document.getElementById("upstreamUrl").value.trim(),
      brokerPacks: brokerPacks,
      targetPolicy: document.getElementById("targetPolicy").value.trim()
    };
  }

  function setMessage(text, kind) {
    var message = document.getElementById("message");
    if (!message) return;
    message.className = "message" + (kind ? " " + kind : "");
    message.textContent = text || "";
  }

  function setBusy(button, busy) {
    if (!button) return;
    button.disabled = busy;
  }

  function api(path, options, token) {
    options = options || {};
    options.headers = Object.assign({ "content-type": "application/json" }, options.headers || {});
    if (token) {
      options.headers.authorization = "Bearer " + token;
    }
    return fetch(path, options).then(function (response) {
      return response.json().catch(function () {
        return {};
      }).then(function (body) {
        if (!response.ok) {
          throw new Error(body.error || "Request failed.");
        }
        return body;
      });
    });
  }

  function attachFormHandlers(mode, token) {
    var inspectButton = document.getElementById("inspectButton");
    inspectButton.addEventListener("click", function () {
      var payload = { upstreamUrl: document.getElementById("upstreamUrl").value.trim() };
      setBusy(inspectButton, true);
      setMessage("Checking upstream...", "");
      api("/inspect", { method: "POST", body: JSON.stringify(payload) }).then(function (body) {
        state.policyGroups = body.policyGroups || [];
        var targetPolicy = document.getElementById("targetPolicy");
        var options = state.policyGroups.length ? state.policyGroups : [body.defaultPolicy || "PROXY"];
        targetPolicy.innerHTML = policyOptions(options);
        targetPolicy.value = body.defaultPolicy || state.policyGroups[0] || "PROXY";
        setMessage("Subscription is readable.", "success");
      }).catch(function (error) {
        setMessage(error.message, "error");
      }).finally(function () {
        setBusy(inspectButton, false);
      });
    });

    document.getElementById("profileForm").addEventListener("submit", function (event) {
      event.preventDefault();
      var payload = collectForm();
      var path = mode === "setup" ? "/setup" : "/profile";
      setMessage("Saving...", "");
      api(path, { method: "POST", body: JSON.stringify(payload) }, token).then(function (body) {
        if (body.adminToken) {
          window.localStorage.setItem(adminStorageKey, body.adminToken);
          token = body.adminToken;
        }
        renderConfigured(body, token);
      }).catch(function (error) {
        setMessage(error.message, "error");
      });
    });
  }

  function renderSetup() {
    setHtml('<h2>Setup</h2>' + formHtml());
    attachFormHandlers("setup");
  }

  function renderLocked() {
    setHtml('' +
      '<h2>Configured</h2>' +
      '<p>This Worker is already configured. Open it with the private management link to edit settings.</p>' +
      '<div class="actions"><button id="forgetButton" class="secondary">Forget local management link</button></div>');
    document.getElementById("forgetButton").addEventListener("click", function () {
      window.localStorage.removeItem(adminStorageKey);
    });
  }

  function linkBlock(label, value, buttonId) {
    return '' +
      '<div class="link-row">' +
        '<strong>' + escapeHtml(label) + '</strong>' +
        '<div class="link-value">' + escapeHtml(value) + '</div>' +
        '<button id="' + buttonId + '" class="secondary" type="button">Copy</button>' +
      '</div>';
  }

  function renderConfigured(body, token) {
    var profile = body.profile || {};
    var subscriptionUrl = body.subscriptionUrl || "";
    var managementUrl = window.location.origin + "/#admin=" + encodeURIComponent(token || "");
    setHtml('' +
      '<h2>Manage</h2>' +
      '<div class="links">' +
        linkBlock("Subscription URL", subscriptionUrl, "copySub") +
        linkBlock("Management link", managementUrl, "copyAdmin") +
      '</div>' +
      '<div class="actions">' +
        '<button id="downloadBackup" class="secondary" type="button">Download backup</button>' +
      '</div>' +
      formHtml(profile));

    document.getElementById("copySub").addEventListener("click", function () {
      navigator.clipboard.writeText(subscriptionUrl);
    });
    document.getElementById("copyAdmin").addEventListener("click", function () {
      navigator.clipboard.writeText(managementUrl);
    });
    document.getElementById("downloadBackup").addEventListener("click", function () {
      var backup = "Subscription URL:\n" + subscriptionUrl + "\n\nManagement link:\n" + managementUrl + "\n";
      var blob = new Blob([backup], { type: "text/plain" });
      var link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "broker-mihomo-patcher-links.txt";
      link.click();
      URL.revokeObjectURL(link.href);
    });
    attachFormHandlers("update", token);
  }

  var token = readAdminToken();
  if (!boot.configured) {
    renderSetup();
    return;
  }

  if (!token) {
    renderLocked();
    return;
  }

  api("/profile", { method: "GET" }, token).then(function (body) {
    renderConfigured(body, token);
  }).catch(function () {
    renderLocked();
  });
})();
`;
}
