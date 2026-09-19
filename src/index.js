#!/usr/bin/env node
/**
 * contract-powers-mcp
 *
 * An MCP server that answers one question about an EVM contract:
 * who can still change it, and what can they do to holders?
 *
 * Data comes from a live registry built and maintained by an autonomous AI
 * agent operated by Ofir Baranes. The registry data is CC0.
 *
 * Disclosure: this server, its data and its code are produced by an
 * autonomous AI agent. Nothing here is an audit or financial advice.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const BASE = process.env.CONTRACT_POWERS_BASE_URL || 'https://agent.zbang.net';
const UA = 'contract-powers-mcp/1.0 (+https://github.com/ofirbaranesad-agent/contract-powers-mcp)';
const CHAINS = ['base', 'ethereum', 'polygon'];

const NOT_AN_AUDIT =
  'Not an audit. Machine-read metadata from verified source and bytecode. ' +
  'A power listed here may be governed, timelocked or renounced in ways this does not model.';

/** Fetch JSON with a timeout, and never throw a bare network error at the model. */
async function getJson(path) {
  const url = `${BASE}${path}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': UA },
      signal: ctl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} from ${url}`, body: text.slice(0, 400) };
    }
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, error: `non-JSON response from ${url}`, body: text.slice(0, 400) };
    }
  } catch (err) {
    return { ok: false, error: `request to ${url} failed: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

/** The registry index is small and changes daily; cache it for the process lifetime. */
let indexCache = null;
let indexCachedAt = 0;
async function registryIndex() {
  if (indexCache && Date.now() - indexCachedAt < 10 * 60 * 1000) return indexCache;
  const data = await getJson('/c/index.json');
  if (data && Array.isArray(data.contracts)) {
    indexCache = data;
    indexCachedAt = Date.now();
  }
  return data;
}

const isAddress = (s) => typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s);

/**
 * Registry names carry a chain suffix ("USDC (Base)", "USDC (native, Polygon)"),
 * so exact equality silently matched exactly one row and answered about the
 * wrong chain without ever reporting ambiguity. Strip the suffix before comparing.
 */
function normaliseName(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^A-Z0-9.]+/g, ' ')
    .trim();
}

/**
 * Resolve a user's "which contract" into registry rows.
 * Accepts an address (any case) or a symbol. Returns every match — the caller
 * reports ambiguity rather than picking one, because the same symbol is
 * deployed on several chains with different powers.
 */
function resolveRow(contracts, query, chain) {
  const q = String(query || '').trim();
  const pool = chain ? contracts.filter((c) => c.chain === chain) : contracts;
  if (isAddress(q)) {
    const addr = q.toLowerCase();
    return pool.filter((c) => c.address.toLowerCase() === addr);
  }
  const want = normaliseName(q);
  if (!want) return [];
  let rows = pool.filter(
    (c) => normaliseName(c.name) === want || normaliseName(c.contractName) === want
  );
  // Only widen to substring if nothing matched exactly, so "USDC" never drags
  // in "USDC.e" while an exact USDC row exists.
  if (rows.length === 0) {
    rows = pool.filter(
      (c) => normaliseName(c.name).includes(want) || normaliseName(c.contractName).includes(want)
    );
  }
  return rows;
}

function text(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

const TOOLS = [
  {
    name: 'list_watched_contracts',
    description:
      'List the EVM contracts in the Contract Powers registry, with a one-line risk shape for each: ' +
      'is the code upgradeable, is the admin a single key (EOA) rather than a contract, how many powers ' +
      'are declared, and is it covered by a bug bounty. Use this to see what is already analysed before ' +
      'spending a lookup. Filters are optional and combine with AND.',
    inputSchema: {
      type: 'object',
      properties: {
        chain: { type: 'string', enum: CHAINS, description: 'Restrict to one chain.' },
        upgradeable: {
          type: 'boolean',
          description: 'true = only contracts whose code can still be replaced.',
        },
        single_key_admin: {
          type: 'boolean',
          description:
            'true = only contracts whose admin is a plain wallet (EOA), not a contract/multisig/timelock.',
        },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Default 200.' },
      },
    },
  },
  {
    name: 'get_contract_powers',
    description:
      'Full free analysis of one contract that is in the registry: verification, proxy pattern and ' +
      'implementation address, who the admin is and whether it is a single key, every retained power ' +
      '(upgrade / mint / pause / blacklist / fees / sweep / burn-from / ownership transfer / limits) with ' +
      'the evidence and confidence behind it, reachable DELEGATECALL / SELFDESTRUCT / CREATE2 opcodes, and ' +
      'the owner-only functions the classifier could NOT categorise — which is where the unusual powers hide. ' +
      'Accepts an address or a symbol such as USDC or AERO.',
    inputSchema: {
      type: 'object',
      properties: {
        contract: { type: 'string', description: 'A 0x address, or a symbol such as USDC.' },
        chain: { type: 'string', enum: CHAINS, description: 'Required if a symbol is ambiguous.' },
      },
      required: ['contract'],
    },
  },
  {
    name: 'check_any_contract',
    description:
      'Free preview for ANY verified EVM contract on base, ethereum or polygon — including addresses not ' +
      'in the registry. Returns contract type, verification, name, whether it is a proxy, how many powers ' +
      'were found, how many owner-only functions went uncategorised, and whether an owner was found. ' +
      'The decision fields (which powers, the evidence, the admin address, the implementation) are withheld ' +
      'and listed by name. Use get_contract_powers first if the contract is already in the registry — that is free and complete.',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: '0x-prefixed 20-byte address.' },
        chain: { type: 'string', enum: CHAINS, description: 'Default base.' },
      },
      required: ['address'],
    },
  },
  {
    name: 'recent_power_changes',
    description:
      'What actually changed behind the watched contracts: implementation swapped, owner moved, a power ' +
      'appeared or disappeared, verification lost. Each event carries the before and after value and the ' +
      'window it was detected in. Severity is one of critical / material / low. Use this to answer ' +
      '"has anything changed behind this contract recently?".',
    inputSchema: {
      type: 'object',
      properties: {
        severity: {
          type: 'string',
          enum: ['critical', 'material', 'low'],
          description: 'Minimum severity to return.',
        },
        contract: { type: 'string', description: 'Filter to one address or symbol.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 25.' },
      },
    },
  },
];

const RANK = { low: 0, material: 1, critical: 2 };

async function handleTool(name, args) {
  if (name === 'list_watched_contracts') {
    const data = await registryIndex();
    if (!Array.isArray(data?.contracts)) return text({ ok: false, error: data?.error || 'registry unavailable' });
    let rows = data.contracts;
    if (args.chain) rows = rows.filter((c) => c.chain === args.chain);
    if (args.upgradeable === true) rows = rows.filter((c) => c.upgradeable === true);
    if (args.upgradeable === false) rows = rows.filter((c) => c.upgradeable === false);
    if (args.single_key_admin === true) rows = rows.filter((c) => c.eoaAdmin === true);
    if (args.single_key_admin === false) rows = rows.filter((c) => c.eoaAdmin === false);
    const limit = args.limit ?? 200;
    return text({
      ok: true,
      generatedAt: data.generatedAt,
      totalInRegistry: data.count,
      matched: rows.length,
      returned: Math.min(rows.length, limit),
      license: data.license,
      contracts: rows.slice(0, limit),
      notAnAudit: NOT_AN_AUDIT,
    });
  }

  if (name === 'get_contract_powers') {
    const data = await registryIndex();
    if (!Array.isArray(data?.contracts)) return text({ ok: false, error: data?.error || 'registry unavailable' });
    const rows = resolveRow(data.contracts, args.contract, args.chain);
    if (rows.length === 0) {
      const hint = isAddress(String(args.contract).trim())
        ? 'This address is not in the registry. Use check_any_contract for a free preview of any address.'
        : 'No registry contract has that symbol. Use list_watched_contracts to see the symbols available.';
      return text({ ok: false, error: 'not in registry', hint });
    }
    if (rows.length > 1) {
      return text({
        ok: false,
        error: 'ambiguous',
        hint: 'That symbol exists on more than one chain. Pass chain to disambiguate.',
        candidates: rows.map((c) => ({ name: c.name, chain: c.chain, address: c.address })),
      });
    }
    const row = rows[0];
    const full = await getJson(`/c/${row.chain}/${row.address}.json`);
    if (full?.ok === false) return text(full);
    return text({ ...full, registryRow: row });
  }

  if (name === 'check_any_contract') {
    const address = String(args.address || '').trim();
    if (!isAddress(address)) {
      return text({ ok: false, error: 'address must be 0x followed by 40 hex characters' });
    }
    const chain = args.chain || 'base';
    // If it is already in the registry, the full answer is free — say so rather
    // than handing back a preview with fields withheld.
    const idx = await registryIndex();
    if (Array.isArray(idx?.contracts)) {
      const known = idx.contracts.find(
        (c) => c.address.toLowerCase() === address.toLowerCase() && c.chain === chain
      );
      if (known) {
        const full = await getJson(`/c/${known.chain}/${known.address}.json`);
        if (full?.ok !== false) {
          return text({
            ...full,
            note: 'This contract is in the registry, so the complete analysis is free — no preview needed.',
            registryRow: known,
          });
        }
      }
    }
    const preview = await getJson(
      `/api/contract/preview?chain=${encodeURIComponent(chain)}&address=${encodeURIComponent(address)}`
    );
    return text({ ...preview, notAnAudit: NOT_AN_AUDIT });
  }

  if (name === 'recent_power_changes') {
    const data = await getJson('/c/changes/changes.json');
    if (!Array.isArray(data?.events)) return text({ ok: false, error: data?.error || 'change feed unavailable' });
    let events = data.events;
    if (args.severity) {
      const floor = RANK[args.severity] ?? 0;
      events = events.filter((e) => (RANK[e.sev] ?? 0) >= floor);
    }
    if (args.contract) {
      const q = String(args.contract).trim();
      const addr = isAddress(q) ? q.toLowerCase() : null;
      const sym = addr ? null : normaliseName(q);
      events = events.filter((e) =>
        addr
          ? String(e.address || '').toLowerCase() === addr
          : normaliseName(e.label).includes(sym)
      );
    }
    const limit = args.limit ?? 25;
    return text({
      ok: true,
      generatedAt: data.generatedAt,
      contractsWatched: data.contractsWatched,
      license: data.license,
      matched: events.length,
      returned: Math.min(events.length, limit),
      events: events.slice(0, limit),
      cadence:
        'Snapshots are taken periodically, not continuously. Each event states the window it was ' +
        'detected in — an event is "something changed between these two dates", not "changed just now".',
      notAnAudit: NOT_AN_AUDIT,
    });
  }

  return text({ ok: false, error: `unknown tool: ${name}` });
}

const server = new Server(
  { name: 'contract-powers', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    return await handleTool(name, args || {});
  } catch (err) {
    // A thrown error inside a tool becomes an MCP protocol error and the model
    // loses the reason. Hand back the reason as a normal result instead.
    return { ...text({ ok: false, error: err.message }), isError: true };
  }
});

await server.connect(new StdioServerTransport());
