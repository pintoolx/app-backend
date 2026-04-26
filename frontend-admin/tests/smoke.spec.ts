import { expect, test, type Page } from '@playwright/test';

async function waitForHydration(page: Page) {
  await page.waitForSelector('body[data-admin-hydrated="true"]');
}

test('renders the login form', async ({ page }) => {
  await page.goto('/login');
  await waitForHydration(page);

  await expect(page.getByRole('heading', { name: 'PinTool Admin' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
});

test('shows login validation errors', async ({ page }) => {
  await page.goto('/login');
  await waitForHydration(page);

  await page.getByLabel('Email').fill('invalid-email');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText('Enter a valid email')).toBeVisible();
  await expect(page.getByText('Password required')).toBeVisible();
});

test('redirects protected admin routes to login', async ({ page }) => {
  await page.goto('/overview');

  await expect(page).toHaveURL(/\/login\?next=%2Foverview$/);
});

test('redirects verify flow back to login without the temp cookie', async ({ page }) => {
  await page.goto('/login/verify');

  await expect(page).toHaveURL(/\/login$/);
});
