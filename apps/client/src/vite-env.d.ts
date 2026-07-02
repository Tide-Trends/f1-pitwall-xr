/// <reference types="vite/client" />

interface PitwallElectron {
  platform: string;
  isElectron: boolean;
  openF1TV: () => Promise<{ opened: boolean }>;
  finishF1TVLogin: () => Promise<{
    subscriptionToken: string;
    entitlementToken?: string;
    entitlement?: string;
    groupId?: number;
    cookies: { cookieHeader: string };
  }>;
  completeLogin: (payload: Record<string, unknown>) => Promise<{
    ok: boolean;
    tokens: import('@pitwall/shared').AuthTokens;
  }>;
}

interface Window {
  pitwall?: PitwallElectron;
}
