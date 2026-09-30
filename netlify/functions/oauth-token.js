const ALLOWED_METHODS = ['POST', 'OPTIONS'];

exports.handler = async (event) => {
    if (!ALLOWED_METHODS.includes(event.httpMethod)) {
        return { statusCode: 405, headers: { Allow: ALLOWED_METHODS.join(', ') }, body: JSON.stringify({ error: 'method_not_allowed' }) };
    }
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': event.headers?.origin || '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
    }

    try {
        const body = JSON.parse(event.body || '{}');
        const { grant_type = 'authorization_code', code, code_verifier, redirect_uri, client_id, refresh_token } = body;
        const normalizedClientId = typeof client_id === 'string' ? client_id.trim() : '';
        const normalizedRedirectUri = typeof redirect_uri === 'string' ? redirect_uri.trim() : '';
        const configuredClientId = (process.env.CLIENT_ID || process.env.NEXT_PUBLIC_DERIV_APP_ID || process.env.APP_ID || '34xH6e3NlK0tqfZuahfVj').trim();
        const configuredRedirectUri = (process.env.REDIRECT_URI || 'https://dynamic-kelpie-0708c4.netlify.app').trim();

        if (!normalizedClientId || (grant_type === 'authorization_code' && (!code || !code_verifier || !normalizedRedirectUri)) || (grant_type === 'refresh_token' && !refresh_token)) {
            return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'invalid_request', error_description: 'code, code_verifier, redirect_uri and client_id are required' }) };
        }
        if (!configuredClientId || normalizedClientId !== configuredClientId) {
            return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'invalid_client', error_description: 'The OAuth client_id is not configured correctly.' }) };
        }
        // Public PKCE client (token_endpoint_auth_method=none): do not send client_secret
        // or an Authorization: Basic header to the Deriv token endpoint.
        if (grant_type === 'refresh_token') {
            const refreshParams = new URLSearchParams({ grant_type: 'refresh_token', client_id: configuredClientId, refresh_token });
            const refreshResponse = await fetch('https://auth.deriv.com/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: refreshParams.toString() });
            const refreshData = await refreshResponse.json();
            return { statusCode: refreshResponse.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(refreshData) };
        }

        if (!configuredRedirectUri || normalizedRedirectUri !== configuredRedirectUri) {
            return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'invalid_redirect_uri', error_description: 'The redirect URI does not match the configured OAuth redirect URI.' }) };
        }

        const params = new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: configuredClientId,
            code,
            code_verifier,
            redirect_uri: configuredRedirectUri,
        });

        const response = await fetch('https://auth.deriv.com/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });
        const data = await response.json();

        return {
            statusCode: response.status,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
            body: JSON.stringify(data),
        };
    } catch (error) {
        console.error('[oauth-token] Token exchange failed:', error);
        return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'token_exchange_failed', error_description: 'Unable to complete the OAuth token exchange.' }) };
    }
};
