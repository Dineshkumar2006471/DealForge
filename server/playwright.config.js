const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({ testDir: './e2e', use: { baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5000' }, reporter: 'list' });
