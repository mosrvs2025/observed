// Writes a signed checkpoint of the ledger head to ./anchors/<date>-<seq>.json.
// Commit that file to a public git repo (or timestamp it with OpenTimestamps, or publish the
// hash in any witness you trust) and pass the reference with:  npm run anchor -- <external_ref>
// Until an external reference is attached, a checkpoint is only a server-signed claim.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const store = new Store(process.env.OBSERVED_DATA || join(root, 'data'));
const chain = store.verifyChain();
if (!chain.ok) { console.error('ledger verification FAILED — refusing to anchor', chain.errors.slice(0, 5)); process.exit(1); }
const a = store.anchor(process.argv[2] || null);
mkdirSync(join(root, 'anchors'), { recursive: true });
const file = join(root, 'anchors', `${new Date(a.ts_ms).toISOString().slice(0, 10)}-seq${a.head_seq}.json`);
writeFileSync(file, JSON.stringify({ head_seq: a.head_seq, head_hash: a.head_hash, ts_ms: a.ts_ms, server_sig: a.server_sig, external_ref: a.external_ref, server_key: store.publicJwk }, null, 2) + '\n');
console.log(`checkpoint #${a.head_seq} ${a.head_hash}\nwritten ${file}`);
