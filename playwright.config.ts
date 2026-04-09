import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';


dotenv.config({ path: path.resolve(__dirname, '.env') });

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  fullyParallel: true,
  workers: 2,
  reporter: 'html',

  use: {
    baseURL: process.env.BASE_URL || process.env.URL_TEST,
    actionTimeout: 15000,
    navigationTimeout: 30000,
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'setup', 
      testMatch: '**/*.setup.ts', 
      use: { 
        storageState: undefined 
      },
    },
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json', 
      },
      dependencies: ['setup'], 
    },
  ]
});