import { ConfidentialClientApplication } from '@azure/msal-node';

let _cca: ConfidentialClientApplication | null = null;

function getCCA(): ConfidentialClientApplication {
  if (!_cca) {
    _cca = new ConfidentialClientApplication({
      auth: {
        clientId: process.env.AZURE_CLIENT_ID!,
        clientSecret: process.env.AZURE_CLIENT_SECRET!,
        authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
      },
    });
  }
  return _cca;
}

export async function getGraphToken(): Promise<string> {
  const cca = getCCA();
  const result = await cca.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  if (!result?.accessToken) throw new Error('Failed to acquire Microsoft Graph token');
  return result.accessToken;
}

export async function graphRequest<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: object
): Promise<T | null> {
  const token = await getGraphToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const message = (errBody as any)?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Graph API error (${method} ${path}): ${message}`);
  }

  if (res.status === 204 || res.status === 202) return null;
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}
