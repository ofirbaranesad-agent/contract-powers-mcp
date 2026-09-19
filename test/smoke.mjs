import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['src/index.js'],
  env: { ...process.env, CONTRACT_POWERS_BASE_URL: 'http://127.0.0.1:8899' },
});
const client = new Client({ name: 'test', version: '1' }, { capabilities: {} });
await client.connect(transport);

const { tools } = await client.listTools();
console.log('TOOLS:', tools.map(t => t.name).join(', '));

const cases = [
  ['list_watched_contracts', { upgradeable: true, single_key_admin: true }],
  ['get_contract_powers', { contract: 'AERO' }],
  ['get_contract_powers', { contract: 'USDC' }],                        // negative: ambiguous
  ['get_contract_powers', { contract: 'NOTATOKEN' }],                   // negative: unknown symbol
  ['check_any_contract', { address: 'not-an-address' }],                // negative: bad input
  ['check_any_contract', { address: '0x940181a94a35a4569e4529a3cdfb74e38fd98631', chain: 'base' }],
  ['recent_power_changes', { severity: 'critical' }],
  ['recent_power_changes', { severity: 'low', limit: 3 }],
  ['recent_power_changes', { contract: 'Compound III cUSDCv3' }],
  ['get_contract_powers', { contract: 'USDC', chain: 'base' }],
  ['get_contract_powers', { contract: 'cUSDCv3', chain: 'ethereum' }],
];

for (const [name, args] of cases) {
  const r = await client.callTool({ name, arguments: args });
  const body = JSON.parse(r.content[0].text);
  const keys = Object.keys(body);
  let line = `\n--- ${name} ${JSON.stringify(args)}`;
  line += `\n    ok=${body.ok} keys=${keys.slice(0, 8).join(',')}`;
  if (body.matched !== undefined) line += ` matched=${body.matched} returned=${body.returned}`;
  if (body.error) line += ` error="${body.error}" hint="${body.hint || ''}"`;
  if (body.name) line += ` name=${body.name}`;
  if (body.powers) line += ` powers=${body.powers.length}`;
  if (body.events) line += ` events=${body.events.map(e => e.sev + ':' + e.kind).join(' ')}`;
  if (body.candidates) line += ` candidates=${body.candidates.map(c => c.chain).join('/')}`;
  console.log(line);
}
await client.close();
