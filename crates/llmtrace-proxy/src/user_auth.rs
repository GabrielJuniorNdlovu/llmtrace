//! Dashboard user signup, login, Google OAuth, and session management.
//!
//! Each signup provisions a dedicated tenant. Opaque session tokens use the
//! `llmts_` prefix and are stored as SHA-256 hashes in `user_sessions`.

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use chrono::{Duration, Utc};
use llmtrace_core::{
    ApiKeyRecord, ApiKeyRole, AuthContext, Tenant, TenantId, TenantScope, UserRecord,
    UserSessionRecord,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::{auth_error, hash_api_key};
use crate::proxy::AppState;

/// Prefix for opaque dashboard session tokens.
pub const SESSION_TOKEN_PREFIX: &str = "llmts_";

/// Session lifetime (7 days).
const SESSION_TTL_DAYS: i64 = 7;

/// Minimum accepted password length.
const MIN_PASSWORD_LEN: usize = 8;

/// Number of random bytes in a session token (256 bits).
const SESSION_RANDOM_BYTES: usize = 32;

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

/// Signup request body.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SignupRequest {
    /// Account email (stored lowercased, must be unique).
    pub email: String,
    /// Password (min 8 characters).
    pub password: String,
    /// Optional first name.
    #[serde(default)]
    pub first_name: Option<String>,
    /// Optional last name.
    #[serde(default)]
    pub last_name: Option<String>,
    /// Optional full display name (overrides first/last when set).
    #[serde(default)]
    pub display_name: Option<String>,
}

/// Email/password login request body.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UserLoginRequest {
    /// Account email.
    pub email: String,
    /// Account password.
    pub password: String,
}

/// Google OAuth code exchange request.
#[derive(Debug, Deserialize, ToSchema)]
pub struct GoogleOAuthRequest {
    /// Authorization code from Google's consent redirect.
    pub code: String,
    /// Redirect URI that was used to obtain the code.
    pub redirect_uri: String,
}

/// Public user view returned by auth endpoints.
#[derive(Debug, Serialize, ToSchema)]
pub struct UserView {
    /// User ID.
    #[schema(value_type = String, format = "uuid")]
    pub id: Uuid,
    /// Tenant owned by this user.
    pub tenant_id: TenantId,
    /// Email address.
    pub email: String,
    /// Display name.
    pub display_name: String,
    /// Account creation time.
    #[schema(value_type = String, format = "date-time")]
    pub created_at: chrono::DateTime<Utc>,
}

impl From<&UserRecord> for UserView {
    fn from(user: &UserRecord) -> Self {
        Self {
            id: user.id,
            tenant_id: user.tenant_id,
            email: user.email.clone(),
            display_name: user.display_name.clone(),
            created_at: user.created_at,
        }
    }
}

/// Auth success response containing a one-time session token.
#[derive(Debug, Serialize, ToSchema)]
pub struct AuthSessionResponse {
    /// Opaque session token (prefix `llmts_`). Store in HttpOnly cookie.
    pub session_token: String,
    /// Authenticated user.
    pub user: UserView,
    /// Tenant ID owned by the user.
    pub tenant_id: TenantId,
}

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

/// Hash a password with Argon2id.
pub fn hash_password(password: &str) -> Result<String, String> {
    use argon2::password_hash::{rand_core::OsRng, PasswordHasher, SaltString};
    use argon2::Argon2;

    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| format!("password hash failed: {e}"))
}

/// Verify a password against an Argon2id hash.
pub fn verify_password(password: &str, password_hash: &str) -> bool {
    use argon2::password_hash::{PasswordHash, PasswordVerifier};
    use argon2::Argon2;

    let Ok(parsed) = PasswordHash::new(password_hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

/// Generate an opaque session token and its SHA-256 hash.
#[must_use]
pub fn generate_session_token() -> (String, String) {
    let mut random_bytes = [0u8; SESSION_RANDOM_BYTES];
    rand::thread_rng().fill_bytes(&mut random_bytes);
    let plaintext = format!("{SESSION_TOKEN_PREFIX}{}", hex::encode(random_bytes));
    let hash = hash_api_key(&plaintext);
    (plaintext, hash)
}

/// Return true when `token` looks like a dashboard session token.
#[must_use]
pub fn is_session_token(token: &str) -> bool {
    token.starts_with(SESSION_TOKEN_PREFIX)
}

fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

fn validate_email(email: &str) -> Result<(), &'static str> {
    if email.is_empty() || !email.contains('@') || email.len() > 320 {
        return Err("a valid email address is required");
    }
    let Some((local, domain)) = email.split_once('@') else {
        return Err("a valid email address is required");
    };
    if local.is_empty() || domain.is_empty() || !domain.contains('.') {
        return Err("a valid email address is required");
    }
    Ok(())
}

fn validate_password(password: &str) -> Result<(), String> {
    if password.len() < MIN_PASSWORD_LEN {
        return Err(format!(
            "password must be at least {MIN_PASSWORD_LEN} characters"
        ));
    }
    Ok(())
}

fn display_name_from(req: &SignupRequest) -> String {
    if let Some(ref name) = req.display_name {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    let first = req.first_name.as_deref().unwrap_or("").trim();
    let last = req.last_name.as_deref().unwrap_or("").trim();
    let combined = format!("{first} {last}").trim().to_string();
    if combined.is_empty() {
        normalize_email(&req.email)
            .split('@')
            .next()
            .unwrap_or("user")
            .to_string()
    } else {
        combined
    }
}

async fn issue_session(
    state: &Arc<AppState>,
    user: &UserRecord,
) -> Result<AuthSessionResponse, String> {
    let (plaintext, hash) = generate_session_token();
    let now = Utc::now();
    let session = UserSessionRecord {
        id: Uuid::new_v4(),
        user_id: user.id,
        token_hash: hash,
        expires_at: now + Duration::days(SESSION_TTL_DAYS),
        created_at: now,
    };
    state
        .metadata()
        .create_user_session(&session)
        .await
        .map_err(|e| format!("failed to create session: {e}"))?;

    Ok(AuthSessionResponse {
        session_token: plaintext,
        user: UserView::from(user),
        tenant_id: user.tenant_id,
    })
}

async fn provision_tenant_for_user(
    state: &Arc<AppState>,
    tenant_name: &str,
) -> Result<(Tenant, Option<String>), String> {
    let tenant_id = TenantId::new();
    let (api_token, _) = crate::auth::generate_api_key();
    let tenant = Tenant {
        id: tenant_id,
        name: tenant_name.to_string(),
        api_token,
        plan: "free".to_string(),
        created_at: Utc::now(),
        config: serde_json::json!({}),
        upstream_url: None,
        upstream_api_key_ciphertext: None,
    };

    state
        .metadata()
        .create_tenant(&tenant)
        .await
        .map_err(|e| format!("failed to create tenant: {e}"))?;

    crate::tenant_api::record_audit_for(
        state,
        tenant.id,
        "tenant_created",
        &format!("tenant:{}", tenant.id),
        serde_json::json!({
            "name": tenant.name,
            "plan": tenant.plan,
            "source": "user_signup"
        }),
    )
    .await;

    let (plaintext, hash) = crate::auth::generate_api_key();
    let prefix = crate::auth::key_prefix(&plaintext);
    let key_record = ApiKeyRecord {
        id: Uuid::new_v4(),
        tenant_id: tenant.id,
        name: "Default Key".to_string(),
        key_hash: hash,
        key_prefix: prefix,
        role: ApiKeyRole::Operator,
        created_at: Utc::now(),
        revoked_at: None,
    };
    if let Err(e) = state.metadata().create_api_key(&key_record).await {
        tracing::warn!(tenant_id = %tenant.id, error = %e, "failed to auto-create API key on signup");
        return Ok((tenant, None));
    }

    Ok((tenant, Some(plaintext)))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// `POST /api/v1/auth/signup` — create a user + dedicated tenant, issue session.
pub async fn signup(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SignupRequest>,
) -> Response {
    let email = normalize_email(&body.email);
    if let Err(msg) = validate_email(&email) {
        return auth_error(StatusCode::BAD_REQUEST, msg);
    }
    if let Err(msg) = validate_password(&body.password) {
        return auth_error(StatusCode::BAD_REQUEST, &msg);
    }

    match state.metadata().get_user_by_email(&email).await {
        Ok(Some(_)) => {
            return auth_error(StatusCode::CONFLICT, "an account with this email already exists")
        }
        Ok(None) => {}
        Err(e) => {
            return auth_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("failed to check existing user: {e}"),
            )
        }
    }

    let password_hash = match hash_password(&body.password) {
        Ok(h) => h,
        Err(e) => {
            return auth_error(StatusCode::INTERNAL_SERVER_ERROR, &e);
        }
    };

    let display_name = display_name_from(&body);
    let tenant_name = format!("{display_name}'s workspace");

    let (tenant, _api_key) = match provision_tenant_for_user(&state, &tenant_name).await {
        Ok(t) => t,
        Err(e) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let user = UserRecord {
        id: Uuid::new_v4(),
        tenant_id: tenant.id,
        email: email.clone(),
        password_hash: Some(password_hash),
        display_name,
        google_sub: None,
        created_at: Utc::now(),
    };

    if let Err(e) = state.metadata().create_user(&user).await {
        // Best-effort cleanup of the orphan tenant.
        let _ = state.metadata().delete_tenant(tenant.id).await;
        return auth_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("failed to create user: {e}"),
        );
    }

    match issue_session(&state, &user).await {
        Ok(resp) => (StatusCode::CREATED, Json(resp)).into_response(),
        Err(e) => auth_error(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

/// `POST /api/v1/auth/login` — email/password login, issue session.
pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(body): Json<UserLoginRequest>,
) -> Response {
    let email = normalize_email(&body.email);
    if validate_email(&email).is_err() || body.password.is_empty() {
        return auth_error(StatusCode::BAD_REQUEST, "email and password are required");
    }

    let user = match state.metadata().get_user_by_email(&email).await {
        Ok(Some(u)) => u,
        Ok(None) => return auth_error(StatusCode::UNAUTHORIZED, "invalid credentials"),
        Err(e) => {
            return auth_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("login lookup failed: {e}"),
            )
        }
    };

    let Some(ref hash) = user.password_hash else {
        return auth_error(
            StatusCode::UNAUTHORIZED,
            "this account uses Google sign-in; password login is not available",
        );
    };

    if !verify_password(&body.password, hash) {
        return auth_error(StatusCode::UNAUTHORIZED, "invalid credentials");
    }

    match issue_session(&state, &user).await {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err(e) => auth_error(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

/// `POST /api/v1/auth/logout` — revoke the current session token.
pub async fn logout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Response {
    let Some(token) = extract_bearer(&headers) else {
        return auth_error(StatusCode::UNAUTHORIZED, "session token required");
    };
    if !is_session_token(token) {
        // Admin-key cookies are not DB sessions — treat as a no-op success.
        return Json(serde_json::json!({ "ok": true })).into_response();
    }

    let hash = hash_api_key(token);
    match state.metadata().delete_user_session_by_hash(&hash).await {
        Ok(_) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(e) => auth_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("failed to revoke session: {e}"),
        ),
    }
}

/// `GET /api/v1/auth/me` — return the authenticated dashboard user.
pub async fn me(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
) -> Response {
    let Some(user_id) = auth.user_id else {
        return auth_error(
            StatusCode::UNAUTHORIZED,
            "user session required (admin-key sessions have no user profile)",
        );
    };

    match state.metadata().get_user_by_id(user_id).await {
        Ok(Some(user)) => Json(UserView::from(&user)).into_response(),
        Ok(None) => auth_error(StatusCode::UNAUTHORIZED, "user not found"),
        Err(e) => auth_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("failed to load user: {e}"),
        ),
    }
}

/// `POST /api/v1/auth/oauth/google` — exchange an auth code for a session.
pub async fn google_oauth(
    State(state): State<Arc<AppState>>,
    Json(body): Json<GoogleOAuthRequest>,
) -> Response {
    let client_id = std::env::var("LLMTRACE_GOOGLE_CLIENT_ID").unwrap_or_default();
    let client_secret = std::env::var("LLMTRACE_GOOGLE_CLIENT_SECRET").unwrap_or_default();
    if client_id.is_empty() || client_secret.is_empty() {
        return auth_error(
            StatusCode::NOT_IMPLEMENTED,
            "Google OAuth is not configured (set LLMTRACE_GOOGLE_CLIENT_ID and LLMTRACE_GOOGLE_CLIENT_SECRET)",
        );
    }
    if body.code.trim().is_empty() || body.redirect_uri.trim().is_empty() {
        return auth_error(StatusCode::BAD_REQUEST, "code and redirect_uri are required");
    }

    let token_resp = match exchange_google_code(
        &client_id,
        &client_secret,
        body.code.trim(),
        body.redirect_uri.trim(),
    )
    .await
    {
        Ok(t) => t,
        Err(e) => return auth_error(StatusCode::BAD_GATEWAY, &e),
    };

    let profile = match fetch_google_userinfo(&token_resp.access_token).await {
        Ok(p) => p,
        Err(e) => return auth_error(StatusCode::BAD_GATEWAY, &e),
    };

    if profile.email.trim().is_empty() || profile.sub.trim().is_empty() {
        return auth_error(
            StatusCode::BAD_GATEWAY,
            "Google did not return email and sub claims",
        );
    }

    let email = normalize_email(&profile.email);
    let display_name = {
        let name = profile.name.trim();
        if name.is_empty() {
            email.split('@').next().unwrap_or("user").to_string()
        } else {
            name.to_string()
        }
    };

    // Prefer google_sub match; fall back to email and link the sub.
    let user = match state.metadata().get_user_by_google_sub(&profile.sub).await {
        Ok(Some(u)) => u,
        Ok(None) => match state.metadata().get_user_by_email(&email).await {
            Ok(Some(mut existing)) => {
                existing.google_sub = Some(profile.sub.clone());
                if existing.display_name.is_empty() {
                    existing.display_name = display_name.clone();
                }
                if let Err(e) = state.metadata().update_user(&existing).await {
                    return auth_error(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        &format!("failed to link Google account: {e}"),
                    );
                }
                existing
            }
            Ok(None) => {
                let tenant_name = format!("{display_name}'s workspace");
                let (tenant, _) = match provision_tenant_for_user(&state, &tenant_name).await {
                    Ok(t) => t,
                    Err(e) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, &e),
                };
                let user = UserRecord {
                    id: Uuid::new_v4(),
                    tenant_id: tenant.id,
                    email,
                    password_hash: None,
                    display_name,
                    google_sub: Some(profile.sub.clone()),
                    created_at: Utc::now(),
                };
                if let Err(e) = state.metadata().create_user(&user).await {
                    let _ = state.metadata().delete_tenant(tenant.id).await;
                    return auth_error(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        &format!("failed to create user: {e}"),
                    );
                }
                user
            }
            Err(e) => {
                return auth_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &format!("user lookup failed: {e}"),
                )
            }
        },
        Err(e) => {
            return auth_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("user lookup failed: {e}"),
            )
        }
    };

    match issue_session(&state, &user).await {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err(e) => auth_error(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

fn extract_bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer ").or_else(|| v.strip_prefix("bearer ")))
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

#[derive(Debug, Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct GoogleUserInfo {
    sub: String,
    email: String,
    #[serde(default)]
    name: String,
}

async fn exchange_google_code(
    client_id: &str,
    client_secret: &str,
    code: &str,
    redirect_uri: &str,
) -> Result<GoogleTokenResponse, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("code", code),
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("redirect_uri", redirect_uri),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|e| format!("Google token exchange failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Google token exchange returned {status}: {body}"));
    }

    resp.json::<GoogleTokenResponse>()
        .await
        .map_err(|e| format!("invalid Google token response: {e}"))
}

async fn fetch_google_userinfo(access_token: &str) -> Result<GoogleUserInfo, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://www.googleapis.com/oauth2/v3/userinfo")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Google userinfo request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Google userinfo returned {status}: {body}"));
    }

    resp.json::<GoogleUserInfo>()
        .await
        .map_err(|e| format!("invalid Google userinfo response: {e}"))
}

/// Resolve a session bearer token into an [`AuthContext`] + [`TenantScope`].
///
/// Returns `Ok(None)` when the token is not a session token (caller should
/// continue with other auth methods). Returns `Err(Response)` on hard failures.
pub async fn try_resolve_session(
    state: &AppState,
    token: &str,
    headers: &HeaderMap,
) -> Result<Option<(AuthContext, TenantScope)>, Response> {
    if !is_session_token(token) {
        return Ok(None);
    }

    let hash = hash_api_key(token);
    let session = match state.metadata().get_user_session_by_hash(&hash).await {
        Ok(Some(s)) => s,
        Ok(None) => {
            return Err(auth_error(
                StatusCode::UNAUTHORIZED,
                "Invalid or expired session",
            ))
        }
        Err(e) => {
            tracing::error!("Session lookup failed: {e}");
            return Err(auth_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Authentication service unavailable",
            ));
        }
    };

    let user = match state.metadata().get_user_by_id(session.user_id).await {
        Ok(Some(u)) => u,
        Ok(None) => {
            return Err(auth_error(
                StatusCode::UNAUTHORIZED,
                "Session user no longer exists",
            ))
        }
        Err(e) => {
            tracing::error!("Session user lookup failed: {e}");
            return Err(auth_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Authentication service unavailable",
            ));
        }
    };

    // Session users are tenant-scoped operators; cross-tenant is forbidden.
    if headers
        .get("x-llmtrace-tenant-scope")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.eq_ignore_ascii_case("all"))
    {
        return Err(auth_error(
            StatusCode::FORBIDDEN,
            "Cross-tenant scope (X-LLMTrace-Tenant-Scope: all) requires admin role",
        ));
    }

    Ok(Some((
        AuthContext {
            tenant_id: user.tenant_id,
            role: ApiKeyRole::Operator,
            key_id: None,
            user_id: Some(user.id),
        },
        TenantScope::Single(user.tenant_id),
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_and_verify_password() {
        let hash = hash_password("correct-horse").unwrap();
        assert!(verify_password("correct-horse", &hash));
        assert!(!verify_password("wrong-password", &hash));
    }

    #[test]
    fn test_rejects_short_password() {
        assert!(validate_password("short").is_err());
        assert!(validate_password("longenough").is_ok());
    }

    #[test]
    fn test_validate_email() {
        assert!(validate_email("a@b.co").is_ok());
        assert!(validate_email("").is_err());
        assert!(validate_email("no-at").is_err());
        assert!(validate_email("@nodomain.com").is_err());
    }

    #[test]
    fn test_session_token_prefix() {
        let (token, hash) = generate_session_token();
        assert!(is_session_token(&token));
        assert_eq!(hash, hash_api_key(&token));
        assert!(!is_session_token("llmt_notasession"));
    }

    #[test]
    fn test_display_name_from_parts() {
        let req = SignupRequest {
            email: "user@example.com".to_string(),
            password: "password1".to_string(),
            first_name: Some("Ada".to_string()),
            last_name: Some("Lovelace".to_string()),
            display_name: None,
        };
        assert_eq!(display_name_from(&req), "Ada Lovelace");
    }
}
