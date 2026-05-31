# Nuria Auth — modelo de sessão & SSO (decisão de arquitetura)

> Status: **proposta / aguardando decisão** (Model 1 vs Model 2). Escrito a partir
> da auditoria de 2026-05-30 do `nuria-auth` (kernel), `nuria-auth-sdk` (v8) e
> `nuria-auth-accounts` (portal). Pré-requisito do workstream de SSO front-end.

## TL;DR

- O **access token vive só em memória**; o **refresh token vive só no cookie
  HttpOnly `__Host-nuria_rt`** (host-locked em `auth.nuria.com.br`). Isso é o
  v8 do SDK e já está implementado. Nada de token em `localStorage`.
- O **login único** **não** vem de "espalhar o cookie pelos sites" (o `__Host-`
  proíbe `Domain`, então o cookie só existe para `auth.nuria.com.br`). Ele vem
  de **um único ponto de sessão** que os apps reaproveitam.
- Hoje existem, de fato, **dois mecanismos sobrepostos** de SSO. Precisamos
  escolher um como oficial (ver Model 1 vs Model 2) porque eles têm tradeoffs
  de segurança diferentes.

## Como funciona hoje (fatos do código)

### O cookie de refresh
`BaseFacade.AppendRefreshTokenCookie`:
`__Host-nuria_rt`, `HttpOnly; Secure; SameSite=Lax; Path=/`, **sem `Domain`**.
- `__Host-` ⇒ host-only: o cookie pertence **exclusivamente** a
  `auth.nuria.com.br`. Não entra no "cookie jar" de `accounts.nuria.com.br`,
  `my-connect.nuria.com.br`, etc.
- `SameSite=Lax` + subdomínios do mesmo *registrable domain* (`nuria.com.br`)
  ⇒ são **same-site**: o cookie **é enviado** num `fetch(..., {credentials:'include'})`
  feito de qualquer `*.nuria.com.br` **para** `auth.nuria.com.br`.

### Refresh não é client-bound (achado C)
`RefreshTokenSession` (DynamoDB) **não tem `ClientId`**. `RefreshTokenService.Issue`
/ `Rotate` e `AuthController.Refresh` validam só o **subject**, não o client.
`OAuthController.ExchangeRefreshToken` apenas checa `_ensureClientExists(client_id)`
(que o client existe), **não** que o refresh token pertence a ele. O access token
emitido é por-subject, `aud="nuria"` genérico — **não** escopado por client.

➡️ Consequência: **qualquer client registrado** que apresente o cookie/refresh
token consegue renovar a sessão daquele subject. Isso é o que faz o "refresh via
cookie compartilhado" funcionar de graça entre apps — e ao mesmo tempo é a
ausência de isolamento por app.

### O `/v2/oauth/authorize` não usa cookie
`OAuthController.BuildAuthorizeRedirectUrl` resolve a sessão via
`ResolveAuthToken(request.SessionToken, headerToken)` — ou seja, **o caller passa
o access token** (`session_token=` / header), não há sessão de cookie no
authorize. Sem token, ele **redireciona pro `accounts/signin`**
(`BuildLoginRedirectUrl`). `prompt=none` **não** é honrado: o DTO tem `Prompt`,
mas o authorize só o repassa pro login UI — não existe caminho "retorna
`login_required` sem UI". Logo **silent auth por iframe (`prompt=none`) não
funciona** contra o backend atual.

➡️ Consequência: a "sessão SSO central" de fato hoje mora no **portal accounts**
(que tem a sessão em memória e a injeta no authorize). O middleware do accounts
já faz esse handoff: ao ver `response_type=code&client_id&...` em `/signin` com
sessão presente, redireciona pro authorize com `session_token`.

## Os dois mecanismos de SSO que coexistem

1. **Refresh via cookie compartilhado** (o que o SDK v8 usa para renovar):
   `*.nuria.com.br` → `POST auth.nuria.com.br/v2/oauth/token` (cookie) → novo
   access token. Funciona para **qualquer** app porque o refresh não é
   client-bound. É a renovação silenciosa em reload, sem `localStorage`.

2. **Authorize redirect via portal accounts** (o "login único" clássico):
   app → `auth/v2/oauth/authorize` → (sem sessão) → `accounts/signin` → accounts
   tem sessão → authorize com `session_token` → `code` → app troca por tokens.

Hoje (1) já cobre o caso de renovação silenciosa para qualquer app; (2) cobre o
primeiro login / handoff entre apps.

## Decisão: Model 1 vs Model 2

### Model 1 — Sessão de subject compartilhada (estado atual)
Um refresh token por **subject**; o cookie em `auth.nuria.com.br` é a sessão; todo
app `*.nuria.com.br` renova silenciosamente via cookie.

- ✅ Simples; SSO e renovação silenciosa "de graça"; nada em `localStorage`.
- ✅ Já implementado (SDK v8). Sem trabalho de backend.
- ❌ **Sem isolamento por app**: qualquer client registrado pode mintar um access
  token do subject via o cookie. Um client comprometido/malicioso renova a
  sessão de qualquer usuário que tenha o cookie naquele browser.
- ❌ Tokens não escopados por client (`aud="nuria"`), então um RS não consegue
  exigir "este token foi emitido para o client X".

**Mitigantes atuais:** access token curto (15 min), cookie `HttpOnly`+same-site,
clients precisam ser registrados, `prompt=login` força reauth no logout.

### Model 2 — Token por app + sessão SSO central (isolamento real)
Cada app é um OAuth client com **seus próprios tokens**; o refresh é **vinculado
ao `client_id`**; a sessão SSO central reconhece o usuário no authorize.

Requer **mudanças de backend**:
1. `ClientId` em `RefreshTokenSession` + validar em `Rotate`/`ExchangeRefreshToken`
   (rejeitar uso cross-client). *(fecha o achado C)*
2. Access token escopado por client (`aud = client_id` ou similar).
3. Para renovação **silenciosa sem redirect** em SPAs consumidoras (sem refresh
   token no app): honrar `prompt=none` no authorize (retornar `login_required`
   em vez de redirecionar pro login) **e** uma sessão de cookie no próprio
   authorize (ou `response_mode=web_message`) para o iframe funcionar
   cross-origin. Sem isso, o silent-auth por iframe **não** é viável.

- ✅ Isolamento por app; blast radius mínimo; tokens auditáveis por client.
- ✅ Alinha com o padrão de mercado (cada SPA com silent-auth próprio).
- ❌ Bem mais trabalho de backend; renovação cross-app de um app "novo" precisa
  do iframe `prompt=none` (itens 3).

### Recomendação — **DECIDIDA (Lucas, 2026-05-31): Model 1 + hardening C compatível**
Manter a renovação por cookie, mas **vincular o refresh token ao `client_id`**
e, no `ExchangeRefreshToken`, permitir o cookie renovar **apenas** para o client
que o emitiu — exceto um conjunto explícito de "first-party clients" confiáveis
(accounts + portais internos) que podem compartilhar a sessão. Assim:
- portais internos (`*.nuria.com.br` first-party) seguem com SSO/renovação
  silenciosa de graça;
- clients de terceiros ficam isolados (não conseguem renovar a sessão de outro).

✅ **Implementado no kernel** (`feat/auth-next-gen`, commit `96ef57a`):
`RefreshTokenSession.ClientId`; `RefreshTokenService.Issue(...clientId)` +
`Rotate` preserva + `GetClientId` (peek sem consumir); `FirstPartyClientPolicy`
**gateada por env `FIRST_PARTY_OAUTH_CLIENTS`** (vazio = Model 1 atual, zero
risco no deploy); `OAuthController` binda code/device-flow ao client e valida no
refresh **antes** de rotacionar. 371 testes verdes. **Falta só ops setar
`FIRST_PARTY_OAUTH_CLIENTS`** (GUIDs dos clients first-party) pra ligar.

Migrar para **Model 2 pleno** (com silent-auth por iframe) só quando houver
necessidade de SPAs de terceiros com renovação silenciosa sem redirect — aí
implementamos os itens 3 e o helper `silentAuthorize()` no SDK (ver abaixo).

## SDK — o que já existe e o que falta

Já existe (v8):
- Access token em memória; refresh via cookie (`credentials:'include'`).
- `startLogin()` / `handleRedirectCallback()` (authorize code + PKCE) — é o
  mecanismo de SSO por redirect (Model 1 e 2).
- `startLogin({ prompt: 'none' })` redireciona top-level com `prompt=none`
  (mas o backend ainda não trata `prompt=none` de forma silenciosa).

Falta (depende de Model 2 / backend):
- `silentAuthorize()` por iframe oculto + `postMessage` (renovação sem redirect).
  **Não implementar** enquanto o backend não honrar `prompt=none` +
  iframe/`web_message`; senão o iframe cai no login e é bloqueado por
  X-Frame-Options. Documentado aqui como trabalho futuro.

## Itens acionáveis
- [x] **Decisão do Lucas:** Model 1 (com hardening C). *(2026-05-31)*
- [x] Backend: `ClientId` no `RefreshTokenSession` + validação no rotate/exchange
      (achado C). *(kernel `96ef57a`, env-gated por `FIRST_PARTY_OAUTH_CLIENTS`)*
- [ ] **Ops:** setar `FIRST_PARTY_OAUTH_CLIENTS` (GUIDs dos clients first-party:
      accounts + portais internos) para LIGAR a enforcement. Sem isso fica em
      Model 1 puro (sem isolamento).
- [ ] CORS do kernel: `Access-Control-Allow-Credentials: true` para as origens
      `*.nuria.com.br` (necessário pro cookie fluir cross-origin no refresh).
- [ ] (Model 2 — adiado) backend honrar `prompt=none` + sessão no authorize;
      depois `silentAuthorize()` no SDK.
