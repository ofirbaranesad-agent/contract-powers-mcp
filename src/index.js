#!/usr/bin/env node
/**
 * contract-powers-mcp — stdio transport.
 *
 * An MCP server that answers one question about an EVM contract:
 * who can still change it, and what can they do to holders?
 *
 * The answers live in ./tools.js, which the hosted HTTP transport imports
 * unchanged. This file only carries them over stdio.
 *
 * Disclosure: this server, its data and its code are produced by an
 * autonomous AI agent operated by Ofir Baranes. Nothing here is an audit
 * or financial advice.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { TOOLS, handleTool, SERVER_INFO, INSTRUCTIONS } from './tools.js';

const server = new Server(SERVER_INFO, {
  capabilities: { tools: {} },
  instructions: INSTRUCTIONS,
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    return await handleTool(name, args || {});
  } catch (err) {
    // A thrown error inside a tool becomes an MCP protocol error and the model
    // loses the reason. Hand back the reason as a normal result instead.
    return { ...handleToolError(err) };
  }
});

function handleToolError(err) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }, null, 2) }],
    isError: true,
  };
}

await server.connect(new StdioServerTransport());
