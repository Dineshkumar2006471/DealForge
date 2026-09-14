const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Frontend Modernization: React 18 + Vite 5 Build & Components Contract', async (t) => {
  const frontendDir = path.resolve(__dirname, '..', '..', 'frontend');
  const distDir = path.join(frontendDir, 'dist');
  const hasDist = fs.existsSync(distDir) && fs.existsSync(path.join(distDir, 'index.html'));

  await t.test(
    'Production Build Artifacts: dist/index.html exists and mounts React SPA root',
    {
      skip: !hasDist ? 'frontend/dist not present in isolated test runner (built during frontend build job)' : false,
    },
    () => {
      const indexPath = path.join(distDir, 'index.html');
      assert.ok(fs.existsSync(indexPath), 'dist/index.html must exist after vite build');
      const content = fs.readFileSync(indexPath, 'utf8');
      assert.ok(
        content.includes('id="root"') || content.includes('DealForge'),
        'Must contain React root or DealForge landing page',
      );
      assert.ok(content.includes('DealForge'), 'Must contain DealForge title/branding');
    },
  );

  await t.test(
    'Production Bundles: dist/assets contains hashed JS and CSS bundles',
    {
      skip: !hasDist ? 'frontend/dist not present in isolated test runner' : false,
    },
    () => {
      const assetsDir = path.join(distDir, 'assets');
      assert.ok(fs.existsSync(assetsDir), 'dist/assets directory must exist');
      const files = fs.readdirSync(assetsDir);
      assert.ok(
        files.some((f) => f.endsWith('.js')),
        'Must contain bundled JavaScript',
      );
      assert.ok(
        files.some((f) => f.endsWith('.css')),
        'Must contain bundled CSS',
      );
    },
  );

  await t.test(
    'Backward Compatibility: static HTML pages and public assets are preserved in dist',
    {
      skip: !hasDist ? 'frontend/dist not present in isolated test runner' : false,
    },
    () => {
      const callPage = path.join(distDir, 'call.html');
      const logo = path.join(distDir, 'DealForge-logo.png');
      assert.ok(fs.existsSync(callPage), 'call.html must be preserved in dist for voice call compatibility');
      assert.ok(fs.existsSync(logo), 'DealForge-logo.png must be present in dist');
    },
  );

  await t.test('Component Structure: All required components exist in frontend/src/components', () => {
    const componentsDir = path.join(frontendDir, 'src', 'components');
    const requiredComponents = [
      'DealWorkspace.jsx',
      'DealTable.jsx',
      'MEDDICMatrix.jsx',
      'EvidencePanel.jsx',
      'ApprovalPanel.jsx',
      'TranscriptPanel.jsx',
      'CallControls.jsx',
      'IntegrationCard.jsx',
      'ActivityTimeline.jsx',
      'ErrorState.jsx',
      'LoadingState.jsx',
      'EmptyState.jsx',
    ];

    for (const comp of requiredComponents) {
      const compPath = path.join(componentsDir, comp);
      assert.ok(fs.existsSync(compPath), `Component ${comp} must exist`);
      const content = fs.readFileSync(compPath, 'utf8');
      assert.ok(content.includes('export default'), `Component ${comp} must have a default export`);
    }
  });
});
