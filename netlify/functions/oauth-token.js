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
        const { code, code_verifier, redirect_uri, client_id } = body;
        const configuredClientId = process.env.CLIENT_ID || '';
        const clientSecret = process.env.DERIV_CLIENT_SECRET || '';
        const configuredRedirectUri = process.env.REDIRECT_URI || '';

        if (!code || !code_verifier || !redirect_uri || !client_id) {
            return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'invalid_request', error_description: 'code, code_verifier, redirect_uri and client_id are required' }) };
        }
        if (!configuredClientId || client_id !== configuredClientId) {
            return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'invalid_client', error_description: 'The OAuth client_id is not configured correctly.' }) };
        }
        if (!clientSecret) {
            return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'server_configuration_error', error_description: 'DERIV_CLIENT_SECRET is not configured on the server.' }) };
        }
        if (!configuredRedirectUri || redirect_uri !== configuredRedirectUri) {
            return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'invalid_redirect_uri', error_description: 'The redirect URI does not match the configured OAuth redirect URI.' }) };
        }

        const params = new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: configuredClientId,
            client_secret: clientSecret,
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
