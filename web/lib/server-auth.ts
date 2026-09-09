import { verifyIdentityToken, type User } from "@privy-io/node";

export class AuthConfigurationError extends Error {}
export class AuthenticationError extends Error {}

function appId() {
  return process.env.PRIVY_APP_ID ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID;
}

function verificationKey() {
  return process.env.PRIVY_VERIFICATION_KEY;
}

export async function authenticatePrivyRequest(request: Request): Promise<User> {
  const configuredAppId = appId();
  const configuredVerificationKey = verificationKey();
  if (!configuredAppId || !configuredVerificationKey) {
    throw new AuthConfigurationError("Privy server verification is not configured on this deployment yet.");
  }
  const identityToken = request.headers.get("x-privy-id-token");
  if (!identityToken) throw new AuthenticationError("Sign in is required.");
  try {
    return await verifyIdentityToken({
      identity_token: identityToken,
      app_id: configuredAppId,
      verification_key: configuredVerificationKey,
    });
  } catch {
    throw new AuthenticationError("Your sign-in session is no longer valid. Sign in again and retry.");
  }
}

function normalized(value: string) {
  return value.toLowerCase();
}

/** Ensure a rule is bound to a wallet actually linked to the authenticated Privy user. */
export function assertUserOwnsWallet(user: User, walletAddress: string) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) throw new AuthenticationError("A valid wallet address is required.");
  const wanted = normalized(walletAddress);
  const linked = user.linked_accounts as unknown as Array<Record<string, unknown>>;
  const ownsWallet = linked.some((account) => {
    if (typeof account.address === "string" && normalized(account.address) === wanted) return true;
    const smartWallets = Array.isArray(account.smart_wallets) ? account.smart_wallets : [];
    return smartWallets.some((wallet) => typeof wallet === "object" && wallet !== null && "address" in wallet && typeof wallet.address === "string" && normalized(wallet.address) === wanted);
  });
  if (!ownsWallet) throw new AuthenticationError("That wallet is not linked to the signed-in Privy user.");
  return { userId: user.id, walletAddress: wanted };
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthConfigurationError) return { status: 503, body: { error: error.message } };
  if (error instanceof AuthenticationError) return { status: 401, body: { error: error.message } };
  return { status: 500, body: { error: "Authentication failed." } };
}
