import { lazy, Suspense } from 'react';
import React from 'react';
import { createBrowserRouter, createRoutesFromElements, Navigate, Route, RouterProvider } from 'react-router-dom';
import ChunkLoader from '@/components/loader/chunk-loader';
import LocalStorageSyncWrapper from '@/components/localStorage-sync-wrapper';
import RoutePromptDialog from '@/components/route-prompt-dialog';
import { generateOAuthURL } from '@/components/shared';
import { useAccountSwitching } from '@/hooks/useAccountSwitching';
import { useLanguageFromURL } from '@/hooks/useLanguageFromURL';
import { useOAuthCallback } from '@/hooks/useOAuthCallback';
import { StoreProvider } from '@/hooks/useStore';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import { isDemoAccount } from '@/utils/account-helpers';
import { Button } from '@deriv-com/ui';
import { initializeI18n, localize, TranslationProvider } from '@deriv-com/translations';
import CoreStoreProvider from './CoreStoreProvider';
import ErrorBoundary from './ErrorBoundary';
import './app-root.scss';

const Layout = lazy(() => import('../components/layout'));
const AppRoot = lazy(() => import('./app-root'));
const RootGate = lazy(() => import('./RootGate'));
const Landing = lazy(() => import('../pages/landing'));

// Translations CDN is optional — requires TRANSLATIONS_CDN_URL, R2_PROJECT_NAME, and CROWDIN_BRANCH_NAME env vars.
// Without these, the app defaults to English. See user-guide/03-white-labeling.md#translations for setup instructions.
const i18nInstance = initializeI18n({ cdnUrl: '' });

/**
 * Component wrapper to handle language URL parameter
 * Uses the useLanguageFromURL hook to process language switching
 */
const LanguageHandler = ({ children }: { children: React.ReactNode }) => {
    useLanguageFromURL();
    return <>{children}</>;
};

const router = createBrowserRouter(
    createRoutesFromElements(
        <>
            {/* Root: landing page for new/logged-out visitors. Deriv's OAuth
                redirect_uri is registered as the bare domain root for every
                white-label site, so this must keep resolving OAuth callbacks
                through to /app — see RootGate. */}
            <Route
                path='/'
                element={
                    <Suspense fallback={<ChunkLoader message={localize('Loading...')} />}>
                        <TranslationProvider defaultLang='EN' i18nInstance={i18nInstance}>
                            <LanguageHandler>
                                <RootGate />
                            </LanguageHandler>
                        </TranslationProvider>
                    </Suspense>
                }
            />
            {/* Some domains (e.g. moneypool.site) have their OAuth redirect_uri registered
                as /callback rather than the bare root — route it through the same gate. */}
            <Route
                path='/callback'
                element={
                    <Suspense fallback={<ChunkLoader message={localize('Loading...')} />}>
                        <TranslationProvider defaultLang='EN' i18nInstance={i18nInstance}>
                            <LanguageHandler>
                                <RootGate />
                            </LanguageHandler>
                        </TranslationProvider>
                    </Suspense>
                }
            />
            {/* Direct link to the landing page (no session/OAuth gating), for marketing use. */}
            <Route
                path='/welcome'
                element={
                    <Suspense fallback={<ChunkLoader message={localize('Loading...')} />}>
                        <TranslationProvider defaultLang='EN' i18nInstance={i18nInstance}>
                            <LanguageHandler>
                                <Landing />
                            </LanguageHandler>
                        </TranslationProvider>
                    </Suspense>
                }
            />
            <Route
                path='/app'
                element={
                    <Suspense
                        fallback={<ChunkLoader message={localize('Please wait while we connect to the server...')} />}
                    >
                        <TranslationProvider defaultLang='EN' i18nInstance={i18nInstance}>
                            <LanguageHandler>
                                <StoreProvider>
                                    <LocalStorageSyncWrapper>
                                        <RoutePromptDialog />
                                        <CoreStoreProvider>
                                            <Layout />
                                        </CoreStoreProvider>
                                    </LocalStorageSyncWrapper>
                                </StoreProvider>
                            </LanguageHandler>
                        </TranslationProvider>
                    </Suspense>
                }
            >
                {/* All child routes will be passed as children to Layout */}
                <Route index element={<AppRoot />} />
                {/* Catch-all: redirect any unknown path back to the app root (hash-based tab navigation handles the rest) */}
                <Route path='*' element={<Navigate to='/app' replace />} />
            </Route>
        </>
    )
);

/**
 * Stores legacy Deriv OAuth accounts in localStorage for authorization.
 *
 * NOTE: This is called when app_id routing sends users through the legacy platform.
 * According to Deriv OAuth 2.0 docs, when app_id is included, Deriv routes users
 * to whichever platform they belong to (legacy or new). If they're on the legacy
 * platform, they get redirected back with ?acct1=...&token1=... parameters.
 *
 * These legacy tokens are handled separately from new PKCE tokens:
 * - Legacy tokens: Used directly with WebSocket API via api.authorize(token)
 * - PKCE tokens: Exchanged for access_token, then used with DerivWS REST API
 *
 * Both flows converge after the user is authorized in api_base.ts
 *
 * Deriv OAuth returns: ?acct1=CR123&token1=a1-xxx&cur1=USD&acct2=...
 * We store in localStorage:
 *   accountsList   → { loginid: token, ... }      [Used by getToken()]
 *   clientAccounts → { loginid: { currency, token }, ... }
 *   authToken      → token of the first real account (non-VRT)
 *   active_loginid → loginid of the first real account [Used by getAccountId()]
 *   account_type   → 'demo' or 'real'
 */
function storeLegacyAccounts(accounts: import('@/hooks/useOAuthCallback').LegacyAccount[]): void {
    const accountsList: Record<string, string> = {};
    const clientAccounts: Record<string, { currency: string; token: string }> = {};

    for (const { loginid, token, currency } of accounts) {
        accountsList[loginid] = token;
        clientAccounts[loginid] = { currency, token };
    }

    // Store in localStorage (persists across page reloads, picked up by api_base.init())
    localStorage.setItem('accountsList', JSON.stringify(accountsList));
    localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));

    // Pick the first real account (non-VRT) as active; fall back to first account
    const realAccount = accounts.find(a => !isDemoAccount(a.loginid)) ?? accounts[0];
    if (realAccount) {
        localStorage.setItem('authToken', realAccount.token);
        localStorage.setItem('active_loginid', realAccount.loginid);
        const isDemo = isDemoAccount(realAccount.loginid);
        localStorage.setItem('account_type', isDemo ? 'demo' : 'real');

        console.log('[Legacy OAuth] ✅ Legacy account stored:', {
            loginid: realAccount.loginid,
            token_type: typeof realAccount.token,
            token_length: realAccount.token.length,
            account_type: isDemo ? 'demo' : 'real',
            accountsList: accountsList,
        });
    } else {
        console.error('[Legacy OAuth] ❌ No real account found in OAuth response:', accounts);
    }
}

/**
 * Shown when the OAuth callback fails (Deriv error, invalid state, or the
 * server-side code exchange / account bootstrap failing). The app must NOT
 * mount as if the login had succeeded, so the user gets an explicit message
 * and a way to retry instead of silently landing on the logged-out app.
 */
const OAuthErrorScreen = ({ message }: { message: string }) => {
    const [isRetrying, setIsRetrying] = React.useState(false);

    const handleRetry = async () => {
        setIsRetrying(true);
        try {
            const url = await generateOAuthURL();
            if (url) {
                window.location.replace(url);
                return;
            }
        } catch (err) {
            console.error('[OAuth] Failed to start a new login attempt:', err);
        }
        window.location.replace(window.location.origin);
    };

    return (
        <div
            role='alert'
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '16px',
                minHeight: '100vh',
                padding: '24px',
                textAlign: 'center',
            }}
        >
            <h2>{localize('We could not complete your Deriv login')}</h2>
            <p style={{ maxWidth: 480 }}>{message}</p>
            <div style={{ display: 'flex', gap: '12px' }}>
                <Button onClick={handleRetry} disabled={isRetrying}>
                    {localize('Try again')}
                </Button>
                <Button variant='outlined' onClick={() => window.location.replace(window.location.origin)}>
                    {localize('Back to home')}
                </Button>
            </div>
        </div>
    );
};

/**
 * Main App component
 *
 * Responsibilities:
 * 1. OAuth callback handling — both legacy (acct1/token1) and new PKCE flow
 * 2. Account switching from URL (via useAccountSwitching hook)
 * 3. Router provider setup
 */
function App() {
    const { isProcessing, isValid, params, legacyAccounts, error, cleanupURL } = useOAuthCallback();
    const [oauthBootstrapReady, setOauthBootstrapReady] = React.useState(false);
    const [oauthError, setOauthError] = React.useState<string | null>(null);

    useAccountSwitching();

    // Complete the callback before mounting AppRoot. AppRoot initializes the
    // singleton Deriv socket immediately; mounting it before auth_info exists
    // opens the public socket and prevents the later OAuth token from upgrading
    // that connection.
    React.useEffect(() => {
        if (isProcessing) return;

        if (legacyAccounts.length > 0) {
            cleanupURL();
            storeLegacyAccounts(legacyAccounts);
            setOauthBootstrapReady(true);
            return;
        }

        if (isValid && params.code) {
            let cancelled = false;
            (async () => {
                try {
                    const response = await OAuthTokenExchangeService.exchangeCodeForToken(params.code!);
                    if (cancelled) return;
                    cleanupURL();
                    if (!response.access_token) {
                        // Exchange or account bootstrap failed: surface it instead of
                        // silently mounting the logged-out app.
                        console.error('❌ Token exchange failed:', response.error, response.error_description);
                        setOauthError(
                            response.error_description ||
                                response.error ||
                                localize('The login could not be completed. Please try again.')
                        );
                        return;
                    }
                    setOauthBootstrapReady(true);
                } catch (err) {
                    if (cancelled) return;
                    console.error('❌ Token exchange request failed:', err);
                    cleanupURL();
                    setOauthError(localize('The login could not be completed. Please try again.'));
                }
            })();
            return () => {
                cancelled = true;
            };
        }

        if (error) {
            console.error('OAuth callback error:', error);
            setOauthError(error);
            return;
        }
        setOauthBootstrapReady(true);
    }, [isProcessing, isValid, params.code, legacyAccounts, error, cleanupURL]);

    if (oauthError) {
        return <OAuthErrorScreen message={oauthError} />;
    }

    if (!oauthBootstrapReady) {
        return <ChunkLoader message={localize('Connecting to Deriv...')} />;
    }

    return (
        <ErrorBoundary>
            <RouterProvider router={router} />
        </ErrorBoundary>
    );
}

export default App;
