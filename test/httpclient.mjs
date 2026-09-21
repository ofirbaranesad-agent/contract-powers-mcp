// Real MCP client, real SDK — not my own request objects fed back to my own handler.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = new URL(process.argv[2] || 'http://127.0.0.1:3000/mcp');
const client = new Client({ name: 'parity-check', version: '1.0.0' }, { capabilities: {} });
await client.connect(new StreamableHTTPClientTransport(url));
console.log('connected. serverInfo =', JSON.stringify(client.getServerVersion()));
console.log('instructions =', (client.getInstructions() || '').slice(0, 80) + '…');

const { tools } = await client.listTools();
console.log('tools =', tools.map(t => t.name).join(', '));

for (const [name, args] of [
  ['list_watched_contracts', { chain: 'base', limit: 3 }],
  ['get_contract_powers', { contract: 'USDC', chain: 'base' }],
  ['recent_power_changes', { severity: 'critical' }],
  ['check_any_contract', { address: '0x4200000000000000000000000000000000000006', chain: 'base' }],
]) {
  const r = await client.callTool({ name, arguments: args });
  const j = JSON.parse(r.content[0].text);
  console.log(`  ${name} -> ok=${j.ok} ${j.name || j.matched || j.returned || ''}`.trim());
}
// negative control: a tool that does not exist must fail, not return a cheerful empty answer
try { await client.callTool({ name: 'no_such_tool', arguments: {} }); console.log('  CONTROL FAILED: unknown tool was accepted'); }
catch (e) { console.log('  control: unknown tool rejected ->', e.message.slice(0, 60)); }
await client.close();
