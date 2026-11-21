import { serveLegalPage } from '../lib/legal-proxy';

// Public legal page — see app/lib/legal-proxy.ts. No top-level route config
// (revalidate / dynamic) on purpose: it would make `next build` call the API.
export async function GET(): Promise<Response> {
  return serveLegalPage('privacy');
}
