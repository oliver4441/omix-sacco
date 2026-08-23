#!/usr/bin/env node
/**
 * Composio CLI helper — lets the AI agent use Oliver's connected accounts.
 * 
 * Usage:
 *   node scripts/composio.js <command> [args...]
 * 
 * Commands:
 *   list               — List all connected accounts
 *   tools <toolkit>    — List tools for a toolkit (e.g., github, googledrive)
 *   run <toolkit> <action> [params]  — Execute an action
 */

const { Composio } = require('@composio/core');

// SECURITY: never hardcode API keys in source control.
// Set COMPOSIO_API_KEY in your environment (and revoke any key that was ever committed).
const API_KEY = process.env.COMPOSIO_API_KEY;
if (!API_KEY) {
  console.error('Error: COMPOSIO_API_KEY environment variable is required.');
  console.error('Get one at https://app.composio.dev and run: COMPOSIO_API_KEY=ak_... node scripts/composio.js');
  process.exit(1);
}
const composio = new Composio({ apiKey: API_KEY });

async function main() {
  const [,, cmd, ...args] = process.argv;

  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(`
Composio CLI — Access Oliver's connected accounts

Commands:
  list                              List all connected accounts
  account <toolkit>                 Get connected account ID for a toolkit
  tools <toolkit>                   List available tools for a toolkit
  run <toolkit> <action> [params]   Execute an action (params as JSON)
    
Examples:
  node scripts/composio.js list
  node scripts/composio.js account github
  node scripts/composio.js tools github
  node scripts/composio.js run github create_issue '{"title":"Bug","body":"..."}'
`);
    return;
  }

  if (cmd === 'list') {
    const accounts = await composio.connectedAccounts.list();
    const items = accounts.items || [];
    console.log(`\n${items.length} connected accounts:\n`);
    for (const a of items) {
      const toolkit = a.toolkit?.slug || '?';
      const status = a.status || '?';
      const auth = a.authConfig?.authScheme || '?';
      const icon = status === 'ACTIVE' ? '✅' : '❌';
      console.log(`  ${icon} ${toolkit.padEnd(25)} | ${status.padEnd(10)} | ${auth}`);
    }
    console.log(`\nTotal pages: ${accounts.totalPages || 1}`);
    return;
  }

  if (cmd === 'account') {
    const toolkitSlug = args[0];
    if (!toolkitSlug) { console.error('Usage: account <toolkit>'); process.exit(1); }
    const accounts = await composio.connectedAccounts.list();
    const account = accounts.items?.find(
      (a) => a.toolkit?.slug === toolkitSlug && a.status === 'ACTIVE'
    );
    if (account) {
      console.log(`Active account for ${toolkitSlug}:`);
      console.log(JSON.stringify(account, null, 2));
    } else {
      console.log(`No active account for ${toolkitSlug}`);
    }
    return;
  }

  if (cmd === 'tools') {
    const toolkitSlug = args[0];
    if (!toolkitSlug) { console.error('Usage: tools <toolkit>'); process.exit(1); }

    // Get connected account
    const accounts = await composio.connectedAccounts.list();
    const account = accounts.items?.find(
      (a) => a.toolkit?.slug === toolkitSlug && a.status === 'ACTIVE'
    );
    if (!account) { console.error(`No active account for ${toolkitSlug}`); process.exit(1); }

    // Get tools via API
    const resp = await fetch(
      `https://backend.composio.dev/api/v3/tools?toolkit_slug=${toolkitSlug}&limit=100`,
      { headers: { 'x-api-key': API_KEY } }
    );
    const data = await resp.json();
    const tools = data.items || data || [];
    console.log(`\n${tools.length} tools for ${toolkitSlug}:\n`);
    for (const t of tools.slice(0, 50)) {
      const name = t.name || t.slug || t.key || JSON.stringify(t).substring(0, 60);
      const desc = (t.description || '').substring(0, 80);
      console.log(`  ${name.padEnd(40)} ${desc}`);
    }
    if (tools.length > 50) console.log(`  ... and ${tools.length - 50} more`);
    return;
  }

  if (cmd === 'run') {
    const toolkitSlug = args[0];
    const actionName = args[1];
    const params = args[2] ? JSON.parse(args[2]) : {};

    if (!toolkitSlug || !actionName) {
      console.error('Usage: run <toolkit> <action> [params_json]');
      process.exit(1);
    }

    // Get connected account
    const accounts = await composio.connectedAccounts.list();
    const account = accounts.items?.find(
      (a) => a.toolkit?.slug === toolkitSlug && a.status === 'ACTIVE'
    );
    if (!account) { console.error(`No active account for ${toolkitSlug}`); process.exit(1); }

    console.log(`Executing ${toolkitSlug}.${actionName} with account ${account.id}...`);
    
    const result = await composio.actions.execute({
      action: actionName,
      params,
      connectedAccountId: account.id,
    });

    console.log('\nResult:');
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  console.error('Run with --help for usage info');
  process.exit(1);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
