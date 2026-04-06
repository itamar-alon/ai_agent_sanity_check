import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

/**
 * טעינת ה-env מהנתיב המלא
 */
dotenv.config({ path: path.resolve(__dirname, '.env') });

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  fullyParallel: true,
  workers: 2,
  reporter: 'html',

  /* הגדרות כלליות לכל הפרויקטים */
  use: {
    baseURL: process.env.BASE_URL || process.env.URL_TEST,
    actionTimeout: 15000,
    navigationTimeout: 30000,
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'setup', // השם שאתה קורא לו בטרמינל
      testMatch: '**/*.setup.ts', // יחפש כל קובץ שמסתיים ב-setup.ts בתוך תיקיית tests
      use: { 
        storageState: undefined // חשוב! שה-setup יתחיל נקי בלי לחפש עוגיות ישנות
      },
    },
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json', // כאן הטסטים הרגילים ימשכו את העוגיות
      },
      dependencies: ['setup'], // מבטיח שה-setup ירוץ תמיד לפני chromium
    },
  ]
});