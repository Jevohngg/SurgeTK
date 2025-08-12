// forest-agent/server.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });


const { createAgent } = require('@forestadmin/agent');
const { createMongoDataSource } = require('@forestadmin/datasource-mongo');


async function start() {
  const agent = createAgent({
    envSecret : process.env.FOREST_ENV_SECRET,   // from Forest Admin → Environment settings
    authSecret: process.env.FOREST_AUTH_SECRET,  // any long random string you choose
    isProduction: process.env.NODE_ENV === 'production',
  });


  agent.addDataSource(
    createMongoDataSource({
      uri: process.env.MONGODB_URI_FOREST,
      database: 'surgetk',
      // Optional introspection settings, if desired:
      // introspection: { collectionSampleSize: 100, referenceSampleSize: 10 },
      dataSource: { flattenMode: 'auto' }
    })
  );

  const PORT = process.env.FOREST_AGENT_PORT || 3310;
  await agent.mountOnStandaloneServer(PORT);
  await agent.start();
  console.log(`✅ Forest Admin agent running on http://localhost:${PORT}`);
}

start().catch((e) => {
  console.error('❌ Forest agent failed to start:', e);
  process.exit(1);
});
