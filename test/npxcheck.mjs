import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const transport = new StdioClientTransport({
  command: 'npx',
  args: ['-y', 'github:ofirbaranesad-agent/contract-powers-mcp'],
  env: { ...process.env, CONTRACT_POWERS_BASE_URL: 'http://127.0.0.1:8899' },
});
const c = new Client({ name: 'stranger', version: '1' }, { capabilities: {} });
await c.connect(transport);
const { tools } = await c.listTools();
console.log('handshake OK · tools:', tools.map(t => t.name).join(', '));
const r = await c.callTool({ name: 'recent_power_changes', arguments: { severity: 'critical' } });
const b = JSON.parse(r.content[0].text);
console.log('critical events:', b.matched, '→', b.events?.[0]?.label, '|', b.events?.[0]?.detail?.slice(0, 90));
await c.close();
