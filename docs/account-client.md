# Account client

Atualizado em 2026-11-04. `DefaultAccountClient` (`src/client/account-client.ts`) implementa `AccountClient`: wrappers finos, autenticados por Bearer, sobre os endpoints `/v2/me/*` do kernel.

## Sessão e token

O token de acesso é buscado a cada chamada por `getAccessToken`, que o cliente de autenticação mantém renovado por refresh silencioso. O account client não guarda estado de token. Os cabeçalhos vêm de `buildAuthHeaders`, injetado pelo cliente de autenticação para que sessões presas a DPoP enviem o esquema `DPoP` com a prova; sem injeção, usa Bearer simples.

## Regras por chamada

- `enrollPasskey`: o desafio de registro (begin, `navigator.credentials.create()`, finish) é de uso único e preso ao sujeito no servidor, então o fluxo inteiro precisa terminar na mesma sessão.
- `confirmEmailVerification`: não exige sessão, o token já se autentica sozinho; usa o transporte diretamente.
- `getRecoveryCodes`: o kernel responde 404 com `{ error: "not_found", error_description }` quando o TOTP está desligado ou não há códigos (`AuthFacade.GetRecoveryCodes`). O transporte converte isso em `AuthError` com `details.status = 404`, e o método devolve `null`. Qualquer outro erro é repassado.
