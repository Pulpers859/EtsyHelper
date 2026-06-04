import { expect, test } from '@playwright/test';

const demoUrl = '/?demo=1';

test.describe('EtsyHelper smoke suite', () => {
  test('unauthenticated landing page loads', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'PipersPress workspace' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use Google Account' })).toBeVisible();
    await expect(page.getByText('Command Center')).toBeVisible();
  });

  test('demo mode opens the core operator workspace', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(demoUrl, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Demo mode')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'PipersPress workspace' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Command\b/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Studio\b/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Inbox\b/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Catalog\b/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Growth\b/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Launchpad\b/ })).toBeVisible();
    await expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('demo mode tabs render the main value surfaces', async ({ page }) => {
    await page.goto(demoUrl, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Command Center')).toBeVisible();

    await page.getByRole('button', { name: /^Studio\b/ }).click();
    await expect(page.getByRole('heading', { name: 'Plan and queue content' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Publishing queue and history' })).toBeVisible();

    await page.getByRole('button', { name: /^Inbox\b/ }).click();
    await expect(page.getByRole('heading', { name: 'Inbox and buyer replies' })).toBeVisible();

    await page.getByRole('button', { name: /^Catalog\b/ }).click();
    await expect(page.getByRole('heading', { name: 'Inventory, listing quality, and product pipeline' })).toBeVisible();

    await page.getByRole('button', { name: /^Growth\b/ }).click();
    await expect(page.getByRole('heading', { name: 'Growth overview' })).toBeVisible();

    await page.getByRole('button', { name: /^Launchpad\b/ }).click();
    await expect(page.getByRole('heading', { name: 'Set up your live connections.' })).toBeVisible();
  });

  test('local workspace can queue a post and keep it after reload', async ({ page }) => {
    const uniqueContent = `Smoke test post ${Date.now()}`;

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('No content queued')).toBeVisible();

    await page.getByRole('button', { name: /^Studio\b/ }).click();
    await expect(page.getByText('Build a post')).toBeVisible();

    const captionField = page.locator('textarea');
    await expect(captionField).toHaveCount(1);
    await captionField.fill(uniqueContent);

    await page.getByRole('button', { name: 'Add to queue' }).click();
    const publishingQueueSection = page
      .getByRole('heading', { name: 'Publishing queue and history' })
      .locator('xpath=ancestor::div[contains(@class, "rounded-[2rem]")][1]');
    await expect(publishingQueueSection.getByText(uniqueContent, { exact: true })).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /^Studio\b/ }).click();
    await expect(publishingQueueSection.getByText(uniqueContent, { exact: true })).toBeVisible();
  });

  test('mobile navigation opens the studio workspace', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('button', { name: /^Studio\b/ }).click();
    await expect(page.getByText('Plan and queue content')).toBeVisible();
  });
});
