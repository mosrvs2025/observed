// Build → sign (with this device's key) → submit. Used by every write in the app.
import { api } from './api.js';
import { observerBlock, signRecord, rememberMine } from './identity.js';

const ROUTES = { observation: '/api/observations', prediction: '/api/predictions', model: '/api/models', challenge: '/api/challenges', vote: '/api/votes', amendment: '/api/amendments' };

export async function sealRecord(kind, fields) {
  const record = { v: 1, kind, observer: await observerBlock(), ...fields };
  const signature = await signRecord(record);
  const receipt = await api.post(ROUTES[kind], { record, signature });
  api.bust();
  if (kind === 'observation') rememberMine(receipt.id, record.experiment);
  return { receipt, record, signature };
}
