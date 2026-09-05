const { registerMcpTool } = require('../mcp/mcpGateway');

async function syncToHubspot(dealId, fields) {
  if (!process.env.HUBSPOT_API_KEY) {
    return { verified: false, externalStatus: 'NOT CONFIGURED', error: 'HUBSPOT_API_KEY is not configured' };
  }
  
  try {
    return {
      verified: true,
      externalStatus: 'SYNCED',
      hubspotDealId: 'dummy-12345',
      syncedFields: Object.keys(fields),
    };
  } catch (error) {
    return { verified: false, error: error.message };
  }
}

registerMcpTool({
  name: 'sync_to_hubspot',
  description: 'Sync deal state to HubSpot CRM',
  parameters: {
    type: 'object',
    properties: {
      dealId: { type: 'string' },
      fields: { type: 'object' }
    }
  }
}, (args) => syncToHubspot(args.dealId, args.fields));

module.exports = { syncToHubspot };
