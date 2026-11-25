import { randomBytes } from 'node:crypto';
import { expect, request as playwrightRequest, test, type Browser, type Page } from '@playwright/test';

// Real browser, real Next proxy and real Nest blog module, on a disposable database (scripts/blog-backend.cjs).
// Fixtures only seed starting data and simulate other owners' screens (moderation hide, deactivation).

type Account = { email: string; password: string; userId: string };

async function fixture<T = Record<string, never>>(control: string, query: Record<string, string | number> = {}): Promise<T> {
  const context = await playwrightRequest.newContext();
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  const response = await context.post(`http://127.0.0.1:${process.env.BLOG_E2E_BACKEND_PORT || '3130'}/__m2-blog-fixture/${control}?${params}`, { headers: { 'X-M2-Blog-Fixture': 'blog' } });
  const body = await response.json();
  expect(response.status(), JSON.stringify(body)).toBe(200);
  await context.dispose();
  return body as T;
}

/** A word no other test uses, so searches and tags never collide (and never hit another test's cache). */
const unique = (prefix: string) => `${prefix}${randomBytes(4).toString('hex')}`;

async function seedPosts(author: string, query: Record<string, string | number>): Promise<string[]> {
  return (await fixture<{ postIds: string[] }>('posts', { author, ...query })).postIds;
}

/** Calls the API as the page does: same origin, browser cookies, through the Next proxy. */
async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  return page.evaluate(async ([m, p, b]) => {
    const response = await fetch(`/api${p}`, { method: m as string, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, [method, path, body] as const) as Promise<{ status: number; body: T }>;
}

async function signIn(page: Page, account: Account) {
  await page.goto('/login');
  expect((await api(page, 'POST', '/auth/login', { email: account.email, password: account.password })).status).toBe(200);
}

async function newUser(page: Page, query: Record<string, string> = {}): Promise<Account> {
  const account = await fixture<Account>('user', query);
  await signIn(page, account);
  return account;
}

async function signInWithForm(page: Page, account: Account) {
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/** A second, independent browser session (another person). */
async function otherPerson(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

/** Next can briefly stream a hidden copy of the page outside <main>, so look only at what readers see. */
const main = (page: Page) => page.locator('#main-content');
const cards = (page: Page) => main(page).getByRole('article');

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

// A real 1x1 PNG, so the backend's content check (first bytes) accepts it.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /hydrat|Minified React/i.test(message.text())) pageErrors.push(message.text()); });
});
test.afterEach(() => { expect(pageErrors).toEqual([]); });

test.describe('BLG-02, BLG-08, BLG-09: guests browse, filter and search', () => {
  test('tag filter with server pages of ten, and tags are clickable', async ({ page }) => {
    const author = await fixture<Account>('user', { name: 'Layla Farouk' });
    const tag = unique('tag');
    await seedPosts(author.userId, { count: 11, title: 'Desert notes', tags: `${tag},desert` });

    await page.goto('/blog');
    await expect(page.getByRole('heading', { name: 'Travel stories', level: 1 })).toBeVisible();
    await page.goto(`/blog?tag=${tag}`);
    await expect(main(page).getByRole('heading', { name: '11 posts' })).toBeVisible();
    await expect(cards(page)).toHaveCount(10);
    // Newest first without a keyword: the last seeded post leads.
    await expect(cards(page).first().getByRole('heading')).toHaveText('Desert notes 11');
    await expect(main(page).getByText('Page 1 of 2')).toBeVisible();
    await main(page).getByRole('link', { name: 'Next' }).click();
    await expect(page).toHaveURL(new RegExp(`tag=${tag}.*page=2`));
    await expect(cards(page)).toHaveCount(1);
    await expect(main(page).getByText('Page 2 of 2')).toBeVisible();

    // A tag on a card lists that tag's posts.
    await cards(page).first().getByRole('link', { name: /^desert, show posts tagged desert$/ }).click();
    await expect(page).toHaveURL(/\/blog\?tag=desert$/);
    await expect(main(page).getByRole('link', { name: /Tag: #desert/ })).toBeVisible();
  });

  test('keyword search in title, tags and author name, ordered by likes + comments, newest on ties', async ({ page }) => {
    const word = unique('kw');
    const author = await fixture<Account>('user', { name: `Omar ${word}` });
    const other = await fixture<Account>('user', { name: 'Hana Adel' });
    await seedPosts(other.userId, { title: `Quiet ${word} morning`, likes: 1, comments: 0, daysAgo: 1 });
    await seedPosts(other.userId, { title: 'Busy market', tags: word, likes: 3, comments: 2, daysAgo: 5 });
    await seedPosts(other.userId, { title: `Old ${word} tie`, likes: 1, comments: 1, daysAgo: 9 });
    await seedPosts(other.userId, { title: `New ${word} tie`, likes: 2, comments: 0, daysAgo: 2 });
    await seedPosts(author.userId, { title: 'Written by the keyword author', daysAgo: 3 });
    await seedPosts(other.userId, { title: `Draft ${word}`, status: 'DRAFT' });

    await page.goto('/blog');
    await main(page).getByLabel('Search stories').fill(word);
    await main(page).getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(new RegExp(`/blog\\?q=${word}`));
    await expect(main(page).getByRole('heading', { name: new RegExp(`5 results for “${word}”`) })).toBeVisible();
    // Score 5, then 2 (newer), 2 (older), 1, then 0. Drafts never appear.
    await expect(cards(page).getByRole('heading')).toHaveText(['Busy market', `New ${word} tie`, `Old ${word} tie`, `Quiet ${word} morning`, 'Written by the keyword author']);
    await expect(cards(page).first()).toContainText('By Hana Adel');
    await expect(cards(page).first()).toContainText('3 likes');

    await page.goto(`/blog?q=${unique('nothing')}`);
    await expect(main(page).getByText('No results', { exact: true })).toBeVisible();
    await expect(main(page).getByRole('link', { name: 'Show all stories' })).toBeVisible();
  });
});

test.describe('ACC-10: guests sign in and come back', () => {
  test('liking and commenting send a guest to sign in and back to the post', async ({ page }) => {
    const author = await fixture<Account>('user', { name: 'Mona Saleh' });
    const [postId] = await seedPosts(author.userId, { title: unique('Guest post ') });
    const reader = await fixture<Account>('user', { name: 'Karim Nabil' });

    await page.goto(`/blog/${postId}`);
    await expect(main(page).getByText('0 likes')).toBeVisible();
    await main(page).getByRole('link', { name: 'Sign in to like' }).click();
    await expect(page).toHaveURL(/\/login\?returnTo=/);
    await signInWithForm(page, reader);
    await expect(page).toHaveURL(new RegExp(`/blog/${postId}$`));
    await main(page).getByRole('button', { name: 'Like', exact: true }).click();
    await expect(main(page).getByText('1 like', { exact: true })).toBeVisible();

    await page.context().clearCookies();
    await page.goto(`/blog/${postId}`);
    await main(page).getByRole('link', { name: 'Sign in to comment' }).click();
    await signInWithForm(page, reader);
    await expect(page).toHaveURL(new RegExp(`/blog/${postId}#comments$`));
    await expect(main(page).getByLabel('Add a comment')).toBeVisible();
  });

  test('writing a post sends a guest to sign in and back to the editor', async ({ page }) => {
    const account = await fixture<Account>('user');
    await page.goto('/blog/new');
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fblog%2Fnew/);
    await signInWithForm(page, account);
    await expect(page.getByRole('heading', { name: 'Write a post' })).toBeVisible();
  });
});

test.describe('BLG-01, BLG-03, BLG-04, BLG-08: writing posts', () => {
  test('a draft is only in my posts; publishing puts it in search', async ({ page, browser }) => {
    await newUser(page, { name: 'Sara Mostafa' });
    const word = unique('draft');
    const tag = unique('tg');
    await page.goto('/blog/new');

    // Field errors before anything is sent.
    await main(page).getByRole('button', { name: 'Save draft' }).click();
    await expect(main(page).getByText('Enter a title.')).toBeVisible();
    await expect(main(page).getByText('Write the story before saving.')).toBeVisible();

    await main(page).getByLabel('Title').fill(`Felucca ${word}`);
    await main(page).getByLabel('Story').fill('We sailed at dawn.\n\nThe river was calm.');
    // A pasted list becomes separate tags.
    await main(page).getByLabel('New tag').fill(`Nile, ${tag}`);
    await main(page).getByRole('button', { name: 'Add tag' }).click();
    await expect(main(page).getByRole('list', { name: 'Added tags' }).getByRole('listitem')).toHaveText([/#nile/, new RegExp(`#${tag}`)]);
    await main(page).getByRole('button', { name: 'Save draft' }).click();

    await expect(main(page).getByRole('status').filter({ hasText: 'Saved as a draft' })).toBeVisible();
    // The one-time ?saved=draft is removed, so a reload does not repeat the message.
    await expect(page).toHaveURL(/\/blog\/[a-f0-9]{24}\/edit$/);
    await expect(main(page).getByRole('status').filter({ hasText: 'Saved as a draft' })).toBeVisible();
    const postId = page.url().match(/\/blog\/([a-f0-9]{24})\//)![1];

    await page.goto('/blog/mine');
    const row = main(page).getByRole('listitem').filter({ hasText: `Felucca ${word}` });
    await expect(row).toContainText('Draft');
    await expect(row).toContainText('0 likes');
    await expect(row).toContainText('0 comments');
    await expect(row).toContainText(/Last saved \d{1,2} \w{3} \d{4}/);

    await page.goto(`/blog?q=${word}`);
    await expect(main(page).getByText('No results', { exact: true })).toBeVisible();
    // Tag pages are cached for everyone: this read puts "no posts" in the cache.
    await page.goto(`/blog?tag=${tag}`);
    await expect(main(page).getByText('No results', { exact: true })).toBeVisible();
    // The author sees their own draft; a guest gets Not found.
    await page.goto(`/blog/${postId}`);
    await expect(main(page).getByText('Draft: only you can see it')).toBeVisible();
    const guest = await otherPerson(browser);
    await guest.page.goto(`/blog/${postId}`);
    await expect(guest.page.getByRole('heading', { name: 'Page not found' })).toBeVisible();

    await page.goto(`/blog/${postId}/edit`);
    await main(page).getByRole('button', { name: 'Publish' }).click();
    await expect(main(page).getByRole('status').filter({ hasText: 'Your changes are published.' })).toBeVisible();
    // Search is read fresh; the cached tag page was expired by the author's own change.
    await page.goto(`/blog?q=${word}`);
    await expect(cards(page).getByRole('heading')).toHaveText([`Felucca ${word}`]);
    await page.goto(`/blog?tag=${tag}`);
    await expect(cards(page).getByRole('heading')).toHaveText([`Felucca ${word}`]);
    await guest.page.goto(`/blog/${postId}`);
    await expect(guest.page.getByRole('heading', { name: `Felucca ${word}` })).toBeVisible();
    await expect(guest.page.locator('#main-content').getByText('The river was calm.')).toBeVisible();
    await page.goto('/blog/mine');
    await expect(main(page).getByRole('listitem').filter({ hasText: `Felucca ${word}` })).toContainText('Published');
    await guest.context.close();
  });

  test('at most five tags of 30 characters, editable later', async ({ page }) => {
    const author = await newUser(page);
    const [postId] = await seedPosts(author.userId, { title: unique('Tagged '), tags: 'one,two,three,four' });
    await page.goto(`/blog/${postId}/edit`);
    const tagInput = main(page).getByLabel('New tag');

    await tagInput.fill('x'.repeat(31));
    await tagInput.press('Enter');
    await expect(main(page).getByText('Each tag can be at most 30 characters.')).toBeVisible();
    await tagInput.fill('five');
    await tagInput.press('Enter');
    await expect(main(page).getByText('5 / 5 tags')).toBeVisible();
    await tagInput.fill('six');
    await tagInput.press('Enter');
    await expect(main(page).getByText('A post can have at most 5 tags.')).toBeVisible();

    // The server refuses six tags as well, with a field error.
    expect((await api(page, 'PATCH', `/posts/${postId}`, { tags: ['a', 'b', 'c', 'd', 'e', 'f'] })).status).toBe(400);

    await tagInput.fill('');
    await main(page).getByRole('button', { name: 'Remove tag one' }).click();
    await tagInput.fill('Coast');
    await tagInput.press('Enter');
    await main(page).getByRole('button', { name: 'Save changes' }).click();
    await expect(main(page).getByRole('status').filter({ hasText: 'Your changes are published.' })).toBeVisible();
    await page.goto(`/blog/${postId}`);
    await expect(main(page).getByRole('list', { name: 'Tags' }).getByRole('link')).toHaveText([/#two/, /#three/, /#four/, /#five/, /#coast/]);
  });

  test('another user cannot edit, and sees a clear page instead', async ({ page, browser }) => {
    const author = await fixture<Account>('user');
    const [published] = await seedPosts(author.userId, { title: unique('Mine ') });
    const [draft] = await seedPosts(author.userId, { title: unique('Secret '), status: 'DRAFT' });
    await newUser(page);

    await page.goto(`/blog/${published}/edit`);
    await expect(page.getByRole('heading', { name: 'You can’t edit this post' })).toBeVisible();
    expect((await api(page, 'PATCH', `/posts/${published}`, { title: 'Taken over' })).status).toBe(403);
    expect((await api(page, 'DELETE', `/posts/${published}`)).status).toBe(403);
    await page.goto(`/blog/${draft}/edit`);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.goto(`/blog/${published}`);
    await expect(main(page).getByRole('link', { name: 'Edit post' })).toHaveCount(0);

    const admin = await otherPerson(browser);
    await newUser(admin.page, { role: 'ADMIN', name: 'Admin' });
    await admin.page.goto('/blog/new');
    await expect(admin.page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
    await admin.context.close();
  });

  test('deleting a post asks first', async ({ page }) => {
    const author = await newUser(page);
    const title = unique('Delete me ');
    const [postId] = await seedPosts(author.userId, { title });
    await page.goto('/blog/mine');
    const row = main(page).getByRole('listitem').filter({ hasText: title });
    await row.getByRole('button', { name: 'Delete post' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete this post?' });
    await expect(dialog).toContainText(title);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Delete post' }).click();
    await dialog.getByRole('button', { name: 'Delete post' }).click();
    await expect(main(page).getByRole('listitem').filter({ hasText: title })).toHaveCount(0);
    await page.goto(`/blog/${postId}`);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });

  test('deleting the only post on page 2 goes back to page 1; deleting from the editor says so once', async ({ page }) => {
    const author = await newUser(page);
    const [oldest] = await seedPosts(author.userId, { title: unique('Oldest ') });
    await seedPosts(author.userId, { count: 10, title: 'Newer' });
    // My posts are newest first by creation, so the first seeded post is alone on page 2.
    await page.goto('/blog/mine?page=2');
    const items = main(page).getByRole('list', { name: 'Your posts' }).getByRole('listitem');
    await expect(items).toHaveCount(1);
    await items.first().getByRole('button', { name: 'Delete post' }).click();
    await page.getByRole('dialog', { name: 'Delete this post?' }).getByRole('button', { name: 'Delete post' }).click();
    await expect(page).toHaveURL(/\/blog\/mine$/);
    await expect(items).toHaveCount(10);
    await page.goto(`/blog/${oldest}`);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();

    await page.goto('/blog/mine');
    await items.first().getByRole('link', { name: /^Edit/ }).click();
    await main(page).getByRole('button', { name: 'Delete post' }).first().click();
    await page.getByRole('dialog', { name: 'Delete this post?' }).getByRole('button', { name: 'Delete post' }).click();
    await expect(main(page).getByRole('status').filter({ hasText: 'The post was deleted.' })).toBeVisible();
    await expect(page).toHaveURL(/\/blog\/mine$/);
    await expect(main(page).getByRole('status').filter({ hasText: 'The post was deleted.' })).toBeVisible();
    await page.reload();
    await expect(main(page).getByText('The post was deleted.')).toHaveCount(0);
  });
});

test.describe('BLG-05, BLG-06, BLG-07: likes and comments', () => {
  test('like once and remove the like', async ({ page }) => {
    const author = await fixture<Account>('user');
    const [postId] = await seedPosts(author.userId, { title: unique('Likeable ') });
    await newUser(page);
    await page.goto(`/blog/${postId}`);
    const like = main(page).getByRole('button', { name: 'Like', exact: true });
    await expect(like).toHaveAttribute('aria-pressed', 'false');
    await like.click();
    await expect(main(page).getByRole('button', { name: 'Liked', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(main(page).getByText('1 like', { exact: true })).toBeVisible();
    // A second like is refused by the server; the page keeps the real state after reload.
    expect((await api(page, 'POST', `/posts/${postId}/like`)).status).toBe(409);
    await page.reload();
    await expect(main(page).getByRole('button', { name: 'Liked', exact: true })).toBeVisible();
    await expect(main(page).getByText('1 like', { exact: true })).toBeVisible();
    await main(page).getByRole('button', { name: 'Liked', exact: true }).click();
    await expect(main(page).getByText('0 likes')).toBeVisible();
    // Liked again in another tab: this tab's Like gets a 409 and re-reads the real count.
    expect((await api(page, 'POST', `/posts/${postId}/like`)).status).toBe(201);
    await main(page).getByRole('button', { name: 'Like', exact: true }).click();
    await expect(main(page).getByRole('button', { name: 'Liked', exact: true })).toBeVisible();
    await expect(main(page).getByText('1 like', { exact: true })).toBeVisible();
    await main(page).getByRole('button', { name: 'Liked', exact: true }).click();
    await expect(main(page).getByText('0 likes')).toBeVisible();
    await expect(main(page).getByRole('button', { name: 'Like', exact: true })).toHaveAttribute('aria-pressed', 'false');
  });

  test('comment in order, 500 characters at most, edit and delete my own', async ({ page, browser }) => {
    const author = await fixture<Account>('user', { name: 'Yara Fathy' });
    const [postId] = await seedPosts(author.userId, { title: unique('Discuss ') });
    await newUser(page, { name: 'Tarek Amin' });
    await page.goto(`/blog/${postId}`);
    const field = main(page).getByLabel('Add a comment');
    const post = main(page).getByRole('button', { name: 'Post comment' });

    await expect(post).toBeDisabled();
    await field.fill('x'.repeat(501));
    await expect(main(page).getByText('501 / 500 characters (1 too many)')).toBeVisible();
    await expect(post).toBeDisabled();
    expect((await api(page, 'POST', `/posts/${postId}/comments`, { content: 'x'.repeat(501) })).status).toBe(400);
    expect((await api(page, 'POST', `/posts/${postId}/comments`, { content: '   ' })).status).toBe(400);

    await field.fill('First thought');
    await post.click();
    await expect(main(page).getByRole('article', { name: 'Comment by Tarek Amin' })).toContainText('First thought');
    await field.fill('Second thought');
    await post.click();
    const comments = main(page).getByRole('article', { name: /^Comment by/ });
    await expect(comments).toHaveCount(2);
    await expect(comments.locator('p.whitespace-pre-line')).toHaveText(['First thought', 'Second thought']);
    await expect(main(page).getByRole('heading', { name: /Comments \(2 comments\)/ })).toBeVisible();

    await comments.first().getByRole('button', { name: 'Edit' }).click();
    await comments.first().getByLabel('Edit your comment').fill('First thought, edited');
    await comments.first().getByRole('button', { name: 'Save comment' }).click();
    await expect(comments.first()).toContainText('First thought, edited');
    await expect(comments.first()).toContainText('(edited)');

    await comments.last().getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog', { name: 'Delete this comment?' }).getByRole('button', { name: 'Delete comment' }).click();
    await expect(comments).toHaveCount(1);
    await expect(main(page).getByRole('heading', { name: /Comments \(1 comment\)/ })).toBeVisible();

    // Deleted in another tab: Edit/Save and Delete close and reload instead of failing.
    const gone = await api<{ commentId: string }>(page, 'POST', `/posts/${postId}/comments`, { content: 'Soon gone' });
    await page.reload();
    const goneItem = main(page).getByRole('article', { name: /^Comment by/ }).filter({ hasText: 'Soon gone' });
    await goneItem.getByRole('button', { name: 'Edit' }).click();
    expect((await api(page, 'DELETE', `/comments/${gone.body.commentId}`)).status).toBe(204);
    await goneItem.getByRole('button', { name: 'Save comment' }).click();
    await expect(main(page).getByText(/That comment was already deleted/)).toBeVisible();
    await expect(goneItem).toHaveCount(0);
    const gone2 = await api<{ commentId: string }>(page, 'POST', `/posts/${postId}/comments`, { content: 'Also gone' });
    await page.reload();
    const goneItem2 = main(page).getByRole('article', { name: /^Comment by/ }).filter({ hasText: 'Also gone' });
    await goneItem2.getByRole('button', { name: 'Delete' }).click();
    expect((await api(page, 'DELETE', `/comments/${gone2.body.commentId}`)).status).toBe(204);
    await page.getByRole('dialog', { name: 'Delete this comment?' }).getByRole('button', { name: 'Delete comment' }).click();
    await expect(main(page).getByText(/That comment was already deleted/)).toBeVisible();
    await expect(goneItem2).toHaveCount(0);
    await expect(comments).toHaveCount(1);

    // Someone else sees the comment but cannot change it.
    const reader = await otherPerson(browser);
    await newUser(reader.page);
    await reader.page.goto(`/blog/${postId}`);
    const theirs = reader.page.locator('#main-content').getByRole('article', { name: 'Comment by Tarek Amin' });
    await expect(theirs).toContainText('First thought, edited');
    await expect(theirs.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await reader.context.close();
  });

  test('comments come in server pages of ten, oldest first (GEN-05)', async ({ page }) => {
    const author = await fixture<Account>('user');
    const [postId] = await seedPosts(author.userId, { title: unique('Busy thread ') });
    await newUser(page, { name: 'Rana Said' });
    for (let index = 1; index <= 11; index += 1) {
      expect((await api(page, 'POST', `/posts/${postId}/comments`, { content: `Note ${index}` })).status).toBe(201);
    }
    await page.goto(`/blog/${postId}`);
    const comments = main(page).getByRole('article', { name: /^Comment by/ });
    await expect(comments).toHaveCount(10);
    await expect(comments.first()).toContainText('Note 1');
    await expect(main(page).getByText('Page 1 of 2')).toBeVisible();
    await main(page).getByRole('navigation', { name: 'Comment pages' }).getByRole('button', { name: 'Next' }).click();
    await expect(comments).toHaveCount(1);
    await expect(comments.first()).toContainText('Note 11');
    // A new comment lands on the last page, where it is shown.
    await main(page).getByLabel('Add a comment').fill('Note 12');
    await main(page).getByRole('button', { name: 'Post comment' }).click();
    await expect(comments.locator('p.whitespace-pre-line')).toHaveText(['Note 11', 'Note 12']);
  });
});

test.describe('BLG-10 and BLG-13: images and an attached itinerary', () => {
  test('upload a PNG, show it on the post, then remove it', async ({ page }) => {
    const author = await newUser(page);
    const title = unique('Photos ');
    const [postId] = await seedPosts(author.userId, { title });
    await page.goto(`/blog/${postId}/edit`);

    await main(page).getByLabel('Post images').setInputFiles({ name: 'bad.gif', mimeType: 'image/gif', buffer: PNG });
    await expect(main(page).getByText('Only JPG or PNG images are accepted.')).toBeVisible();
    // Named PNG but not a PNG inside: the server's content check refuses it with its field message.
    await main(page).getByLabel('Post images').setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('not an image at all') });
    await expect(main(page).getByText('Image must be a JPG or PNG file')).toBeVisible();
    await main(page).getByLabel('Post images').setInputFiles({ name: 'nile.png', mimeType: 'image/png', buffer: PNG });
    await expect(main(page).getByText('1 / 5')).toBeVisible();

    await page.goto(`/blog/${postId}`);
    const photo = main(page).getByRole('img', { name: `Photo 1 of 1 from “${title}”` });
    await expect(photo).toBeVisible();
    await expect.poll(() => photo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1);

    await page.goto(`/blog/${postId}/edit`);
    await main(page).getByRole('button', { name: 'Remove post images' }).click();
    await expect(main(page).getByText('0 / 5')).toBeVisible();
    await page.goto(`/blog/${postId}`);
    await expect(main(page).getByRole('list', { name: 'Photos' })).toHaveCount(0);
  });

  test('attach one of my public itineraries; private ones are not offered', async ({ page, browser }) => {
    const author = await newUser(page);
    const publicTrip = unique('Public trip ');
    const privateTrip = unique('Private trip ');
    const { itineraryId } = await fixture<{ itineraryId: string }>('itinerary', { author: author.userId, title: publicTrip });
    await fixture('itinerary', { author: author.userId, title: privateTrip, visibility: 'PRIVATE' });
    const [postId] = await seedPosts(author.userId, { title: unique('Trip post ') });

    await page.goto(`/blog/${postId}/edit`);
    const select = main(page).getByLabel('Attach an itinerary (optional)');
    await expect(select.locator('option', { hasText: publicTrip })).toHaveCount(1);
    await expect(select.locator('option', { hasText: privateTrip })).toHaveCount(0);
    await select.selectOption(itineraryId);
    await main(page).getByRole('button', { name: 'Save changes' }).click();
    await expect(main(page).getByRole('status').filter({ hasText: 'Your changes are published.' })).toBeVisible();

    const guest = await otherPerson(browser);
    await guest.page.goto(`/blog/${postId}`);
    const attached = guest.page.locator('#main-content').getByRole('complementary', { name: 'Attached itinerary' });
    await expect(attached.getByRole('link', { name: publicTrip })).toHaveAttribute('href', `/explore/itineraries/${itineraryId}`);
    await expect(attached).toContainText('2 days · Luxor, Aswan');
    await guest.context.close();
  });
});

test.describe('BLG-12, GEN-10, ACC-12: author page and visibility', () => {
  test('author page lists name, join date, published posts and public itineraries', async ({ page }) => {
    const name = unique('Author ');
    const author = await fixture<Account>('user', { name });
    await seedPosts(author.userId, { title: 'Public story' });
    await seedPosts(author.userId, { title: 'Hidden draft', status: 'DRAFT' });
    await fixture('itinerary', { author: author.userId, title: 'Open road' });
    await fixture('itinerary', { author: author.userId, title: 'Just for me', visibility: 'PRIVATE' });

    await page.goto(`/blog?q=${encodeURIComponent(name)}`);
    await cards(page).first().getByRole('link', { name }).click();
    await expect(page).toHaveURL(new RegExp(`/authors/${author.userId}$`));
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(main(page).getByText(/^Joined \w+ \d{4}$/)).toBeVisible();
    await expect(cards(page).getByRole('heading')).toHaveText(['Public story']);
    await expect(main(page).getByRole('link', { name: 'Open road' })).toBeVisible();
    await expect(main(page).getByText('Just for me')).toHaveCount(0);
  });

  test('hidden posts are only for their author; a deactivated author disappears', async ({ page, browser }) => {
    const author = await newUser(page, { name: 'Nadia Kamel' });
    const title = unique('Moderated ');
    const [postId] = await seedPosts(author.userId, { title });
    const commenter = await fixture<Account>('user', { name: 'Gone Soon' });
    const reader = await otherPerson(browser);
    await signIn(reader.page, commenter);
    expect((await api(reader.page, 'POST', `/posts/${postId}/comments`, { content: 'Lovely' })).status).toBe(201);

    await fixture('deactivate', { user: commenter.userId });
    const guest = await otherPerson(browser);
    await guest.page.goto(`/blog/${postId}`);
    await expect(guest.page.locator('#main-content').getByRole('article', { name: 'Comment by Deleted user' })).toContainText('Lovely');

    await fixture('hide', { post: postId });
    await guest.page.goto(`/blog/${postId}`);
    await expect(guest.page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.goto(`/blog/${postId}`);
    await expect(main(page).getByText('Hidden by a moderator: only the author and admins can see it')).toBeVisible();
    await expect(main(page).getByText('Comments open once the post is published and visible to everyone.')).toBeVisible();

    await fixture('hide', { post: postId, hidden: 'false' });
    await fixture('deactivate', { user: author.userId });
    await guest.page.goto(`/authors/${author.userId}`);
    await expect(guest.page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await guest.page.goto(`/blog/${postId}`);
    await expect(guest.page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await guest.context.close();
    await reader.context.close();
  });

  test('blog pages fit 360, 768, 1024 and 1440 px widths without sideways scrolling', async ({ page }) => {
    const author = await fixture<Account>('user');
    const longTitle = `Narrow${'a'.repeat(90)}`;
    const [postId] = await seedPosts(author.userId, { title: longTitle, tags: 'a-rather-long-tag-name-here', content: `${'Long words '.repeat(40)}${'b'.repeat(300)}` });
    await fixture('itinerary', { author: author.userId, title: `Trip${'c'.repeat(90)}` });
    await signIn(page, author);
    expect((await api(page, 'POST', `/posts/${postId}/comments`, { content: 'd'.repeat(400) })).status).toBe(201);
    for (const width of [360, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ['/blog', `/blog/${postId}`, `/authors/${author.userId}`, '/blog/mine']) {
        await page.goto(path);
        await expect(main(page).getByRole('heading', { level: 1 })).toBeVisible();
        await noSidewaysScroll(page);
      }
    }
  });
});
