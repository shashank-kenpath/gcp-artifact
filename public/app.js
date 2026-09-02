// ─── Storage & state ────────────────────────────────────────────────────────
const STORAGE_KEY = 'gcp_artifact_credentials';
const REPO_PAGE_SIZE = 12;
const IMAGE_PAGE_SIZE = 20;

let credentials = null;
let repositories = [];
let selectedTransferImage = null;

let repoSearchQuery = '';
let repoPage = 1;

const repoDetail = {
  location: null,
  name: null,
  meta: null,
  format: null,
  images: [],
  packages: [],
  nextPageToken: null,
  loading: false,
  range: '7d',
  search: '',
  reachedEnd: false,
};

const downloadState = {
  location: null,
  name: null,
  images: [],
  nextPageToken: null,
};

// Command palette state
let cmdItems = [];
let cmdActive = 0;

// ─── DOM ────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const els = {
  authScreen: $('authScreen'),
  mainApp: $('mainApp'),
  credentialsInput: $('credentialsInput'),
  validateCredentials: $('validateCredentials'),
  authError: $('authError'),
  projectId: $('projectId'),
  pageTitle: $('pageTitle'),
  pageSubtitle: $('pageSubtitle'),
  breadcrumbs: $('breadcrumbs'),
  refreshBtn: $('refreshBtn'),
  logoutBtn: $('logoutBtn'),
  totalRepos: $('totalRepos'),
  dockerRepos: $('dockerRepos'),
  otherRepos: $('otherRepos'),
  repoList: $('repoList'),
  repoSearch: $('repoSearch'),
  repoPagination: $('repoPagination'),
  repoDetailHeader: $('repoDetailHeader'),
  timelineContainer: $('timelineContainer'),
  timelineMeta: $('timelineMeta'),
  loadMoreWrap: $('loadMoreWrap'),
  loadMoreBtn: $('loadMoreBtn'),
  timeFilters: $('timeFilters'),
  imageSearch: $('imageSearch'),
  popularGrid: $('popularGrid'),
  dockerHubSearch: $('dockerHubSearch'),
  searchDockerHub: $('searchDockerHub'),
  searchResults: $('searchResults'),
  searchResultsBody: $('searchResultsBody'),
  transferSection: $('transferSection'),
  cancelTransfer: $('cancelTransfer'),
  transferSource: $('transferSource'),
  transferDest: $('transferDest'),
  transferRepoSelect: $('transferRepoSelect'),
  transferTagSelect: $('transferTagSelect'),
  transferTargetName: $('transferTargetName'),
  generateTransferCmd: $('generateTransferCmd'),
  transferCommands: $('transferCommands'),
  transferSteps: $('transferSteps'),
  copyAllCommands: $('copyAllCommands'),
  downloadRepoSelect: $('downloadRepoSelect'),
  downloadImageSelect: $('downloadImageSelect'),
  downloadLoadMore: $('downloadLoadMore'),
  pullCommands: $('pullCommands'),
  pullAuthCmd: $('pullAuthCmd'),
  pullImageCmd: $('pullImageCmd'),
  settingsProjectId: $('settingsProjectId'),
  settingsServiceAccount: $('settingsServiceAccount'),
  clearCredentials: $('clearCredentials'),
  // Full-screen modal
  imageModal: $('imageModal'),
  modalTitle: $('modalTitle'),
  modalSubtitle: $('modalSubtitle'),
  modalBadge: $('modalBadge'),
  modalBody: $('modalBody'),
  modalClose: $('modalClose'),
  modalScrim: $('modalScrim'),
  // Command palette
  cmdPalette: $('cmdPalette'),
  cmdScrim: $('cmdScrim'),
  cmdInput: $('cmdInput'),
  cmdResults: $('cmdResults'),
  cmdOpenBtn: $('cmdOpenBtn'),
  toast: $('toast'),
  toastMessage: $('toastMessage'),
};

// ─── Utils ──────────────────────────────────────────────────────────────────
function showToast(message, duration = 2800) {
  els.toastMessage.textContent = message;
  els.toast.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.add('hidden'), duration);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso) {
  if (!iso) return 'N/A';
  return dayjs(iso).format('MMM D, YYYY · HH:mm');
}

function relativeDate(iso) {
  if (!iso) return 'unknown';
  return dayjs(iso).fromNow();
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return 'N/A';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

function getFormatBadgeClass(format) {
  const f = (format || '').toLowerCase();
  if (f.includes('docker')) return 'docker';
  if (f.includes('npm')) return 'npm';
  if (f.includes('maven')) return 'maven';
  if (f.includes('python') || f.includes('pypi')) return 'python';
  return 'unknown';
}

function formatStars(stars) {
  if (stars >= 1e6) return (stars / 1e6).toFixed(1) + 'M';
  if (stars >= 1e3) return (stars / 1e3).toFixed(1) + 'K';
  return String(stars);
}

function getBaseImageName(imageName) {
  const parts = (imageName || '').split('/');
  const lastPart = parts[parts.length - 1];
  if (lastPart.includes('@')) return lastPart.split('@')[0];
  if (lastPart.startsWith('sha256:')) {
    return parts.length > 1 ? parts[parts.length - 2] : lastPart.slice(0, 12);
  }
  return lastPart;
}

function sinceForRange(range) {
  const now = dayjs();
  switch (range) {
    case '24h':
      return now.subtract(24, 'hour').toISOString();
    case '7d':
      return now.subtract(7, 'day').toISOString();
    case '30d':
      return now.subtract(30, 'day').toISOString();
    case '90d':
      return now.subtract(90, 'day').toISOString();
    default:
      return null;
  }
}

function timeBucketLabel(iso) {
  if (!iso) return 'Unknown date';
  const d = dayjs(iso);
  const startOfToday = dayjs().startOf('day');
  const startOfYesterday = startOfToday.subtract(1, 'day');
  const startOfWeek = dayjs().startOf('week');
  const startOfMonth = dayjs().startOf('month');

  if (d.isAfter(startOfToday) || d.isSame(startOfToday)) return 'Today';
  if (d.isAfter(startOfYesterday) || d.isSame(startOfYesterday)) return 'Yesterday';
  if (d.isAfter(startOfWeek) || d.isSame(startOfWeek)) return 'This week';
  if (d.isAfter(startOfMonth) || d.isSame(startOfMonth)) return 'This month';
  return d.format('MMMM YYYY');
}

function groupByTimeBucket(items, dateKey = 'uploadedAt') {
  const order = [];
  const map = new Map();
  items.forEach((item) => {
    const label = timeBucketLabel(item[dateKey] || item.updatedAt || item.createdAt);
    if (!map.has(label)) {
      map.set(label, []);
      order.push(label);
    }
    map.get(label).push(item);
  });
  return order.map((label) => ({ label, items: map.get(label) }));
}

function groupDockerImages(images) {
  const groups = {};
  images.forEach((image) => {
    const baseName = getBaseImageName(image.name);
    if (!groups[baseName]) {
      groups[baseName] = {
        name: baseName,
        variants: [],
        allTags: new Set(),
        totalSize: 0,
        latestUpload: null,
      };
    }
    groups[baseName].variants.push(image);
    (image.tags || []).forEach((t) => groups[baseName].allTags.add(t));
    groups[baseName].totalSize += image.sizeBytes || 0;
    // Prefer update time when ranking "latest"
    const sortAt = image.updatedAt || image.uploadedAt;
    const sortDate = sortAt ? new Date(sortAt) : null;
    if (
      sortDate &&
      (!groups[baseName].latestUpload || sortDate > new Date(groups[baseName].latestUpload))
    ) {
      groups[baseName].latestUpload = sortAt;
    }
  });

  return Object.values(groups)
    .map((g) => ({ ...g, allTags: Array.from(g.allTags) }))
    .sort((a, b) => {
      if (!a.latestUpload) return 1;
      if (!b.latestUpload) return -1;
      return new Date(b.latestUpload) - new Date(a.latestUpload);
    });
}

/**
 * Flatten variants into per-tag rows with digest + timestamps,
 * then group by digest so tags at the same commit/image are one rollback unit.
 * Sorted by update time (newest first).
 */
function buildTagDigestGroups(variants) {
  const byDigest = new Map();

  variants.forEach((v) => {
    const digest = v.digest || extractDigestFromUri(v.uri || v.id || v.name) || `unknown-${v.id || Math.random()}`;
    const shortDigest = v.shortDigest || (digest.startsWith('sha256:') ? digest.slice(7, 19) : digest.slice(0, 12));
    const updatedAt = v.updatedAt || v.uploadedAt || null;
    const tags = v.tags?.length ? v.tags : [];

    if (!byDigest.has(digest)) {
      byDigest.set(digest, {
        digest,
        shortDigest,
        uri: v.uri || null,
        tags: [],
        uploadedAt: v.uploadedAt || null,
        updatedAt,
        buildTime: v.buildTime || null,
        sizeBytes: v.sizeBytes || 0,
        sizeFormatted: v.sizeFormatted || formatSize(v.sizeBytes || 0),
        mediaType: v.mediaType || '',
      });
    }

    const entry = byDigest.get(digest);
    tags.forEach((t) => {
      if (!entry.tags.includes(t)) entry.tags.push(t);
    });
    // Keep the newest timestamps on the group
    if (updatedAt && (!entry.updatedAt || new Date(updatedAt) > new Date(entry.updatedAt))) {
      entry.updatedAt = updatedAt;
    }
    if (v.uploadedAt && (!entry.uploadedAt || new Date(v.uploadedAt) > new Date(entry.uploadedAt))) {
      entry.uploadedAt = v.uploadedAt;
    }
    if ((v.sizeBytes || 0) > (entry.sizeBytes || 0)) {
      entry.sizeBytes = v.sizeBytes;
      entry.sizeFormatted = v.sizeFormatted || formatSize(v.sizeBytes);
    }
  });

  return Array.from(byDigest.values()).sort((a, b) => {
    const ta = new Date(a.updatedAt || a.uploadedAt || 0).getTime();
    const tb = new Date(b.updatedAt || b.uploadedAt || 0).getTime();
    if (tb !== ta) return tb - ta;
    // Stable secondary: digest string
    return (a.digest || '').localeCompare(b.digest || '');
  });
}

function extractDigestFromUri(uri) {
  if (!uri) return null;
  const m = String(uri).match(/sha256:[a-fA-F0-9]+/);
  return m ? m[0].toLowerCase() : null;
}

/** Git commit tags are 7–40 hex chars (not docker digests). */
function isGitCommitTag(tag) {
  return /^[0-9a-f]{7,40}$/i.test(String(tag || ''));
}

/** Channel / env tags (main, bh-dev, …) — not commit SHAs. */
function isChannelTag(tag) {
  const t = String(tag || '');
  if (!t || isGitCommitTag(t)) return false;
  // skip pure numbers that aren't commits
  return true;
}

/** Family key: main-latest → main, bh-dev-latest → bh-dev */
function channelFamily(tag) {
  if (!isChannelTag(tag)) return null;
  return String(tag).replace(/-latest$/i, '').toLowerCase();
}

function getGitCommitFromGroup(g) {
  const commits = (g.tags || []).filter(isGitCommitTag);
  // Prefer full 40-char SHAs
  commits.sort((a, b) => b.length - a.length);
  return commits[0] || null;
}

function getChannelFamiliesOnGroup(g) {
  const set = new Set();
  (g.tags || []).forEach((t) => {
    const f = channelFamily(t);
    if (f) set.add(f);
  });
  return Array.from(set);
}

/** Discover channel families present across digests (main, bh-dev, …). */
function discoverChannels(digestGroups) {
  const map = new Map(); // family → { family, tags: Set, current: group|null }
  digestGroups.forEach((g) => {
    (g.tags || []).forEach((t) => {
      if (!isChannelTag(t)) return;
      const fam = channelFamily(t);
      if (!fam) return;
      if (!map.has(fam)) map.set(fam, { family: fam, tags: new Set(), current: null });
      const entry = map.get(fam);
      entry.tags.add(t);
      // Prefer exact family name as primary tag
      if (!entry.current) entry.current = g;
    });
  });

  // Attach current group: digest that has the base tag or any family tag (newest already sorted)
  for (const entry of map.values()) {
    const base = entry.family;
    entry.current =
      digestGroups.find((g) =>
        (g.tags || []).some((t) => channelFamily(t) === base)
      ) || null;
    entry.primaryTag = (entry.tags.has(base) ? base : Array.from(entry.tags)[0]) || base;
    entry.aliasTags = Array.from(entry.tags).sort();
  }

  return Array.from(map.values()).sort((a, b) => a.family.localeCompare(b.family));
}

/**
 * Builds older than current for a channel, skipping digests that currently
 * belong to a *different* channel family (so previous main ≠ current bh-dev).
 */
function channelRollbackCandidates(channelFamilyName, digestGroups) {
  const fam = String(channelFamilyName || '').toLowerCase();
  const currentIdx = digestGroups.findIndex((g) =>
    (g.tags || []).some((t) => channelFamily(t) === fam)
  );
  if (currentIdx < 0) return { current: null, previous: null, older: [] };

  const current = digestGroups[currentIdx];
  const older = [];

  for (let i = currentIdx + 1; i < digestGroups.length; i++) {
    const g = digestGroups[i];
    const families = getChannelFamiliesOnGroup(g);
    // Skip digests currently owned by another channel (e.g. bh-dev while viewing main)
    const otherOwner = families.some((f) => f !== fam);
    if (otherOwner) continue;
    older.push(g);
  }

  return {
    current,
    previous: older[0] || null,
    older,
  };
}

function registryImagePath(location, repository, imageName) {
  const projectId = credentials?.project_id || 'PROJECT_ID';
  return `${location}-docker.pkg.dev/${projectId}/${repository}/${imageName}`;
}

function generatePullCommand(location, repository, imageName, tag) {
  const tagSuffix = tag ? `:${tag}` : ':latest';
  return `docker pull ${registryImagePath(location, repository, imageName)}${tagSuffix}`;
}

/** Immutable pull — preferred for rollback (tag may move later). */
function generatePullByDigest(location, repository, imageName, digest) {
  const d = digest && digest.startsWith('sha256:') ? digest : digest ? `sha256:${digest}` : '';
  if (!d) return generatePullCommand(location, repository, imageName, 'latest');
  return `docker pull ${registryImagePath(location, repository, imageName)}@${d}`;
}

/** Commands to re-point a channel tag (and -latest) at an older digest. */
function generateRetagChannelCommands(location, repository, imageName, digest, channelFamilyName, aliasTags = []) {
  const path = registryImagePath(location, repository, imageName);
  const d = digest && digest.startsWith('sha256:') ? digest : `sha256:${digest}`;
  const tags = new Set([channelFamilyName, `${channelFamilyName}-latest`, ...aliasTags]);
  // Only keep tags that belong to this family
  const finalTags = Array.from(tags).filter((t) => channelFamily(t) === channelFamilyName.toLowerCase() || t === channelFamilyName || t === `${channelFamilyName}-latest`);

  const lines = [
    `docker pull ${path}@${d}`,
    ...finalTags.map((t) => `docker tag ${path}@${d} ${path}:${t}`),
    ...finalTags.map((t) => `docker push ${path}:${t}`),
  ];
  return lines.join('\n');
}

function syncSearchClear(inputId) {
  const input = $(inputId);
  if (!input) return;
  const clear = document.querySelector(`[data-clear="${inputId}"]`);
  if (!clear) return;
  clear.classList.toggle('hidden', !input.value);
}

// ─── Credentials ────────────────────────────────────────────────────────────
function getStoredCredentials() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function storeCredentials(creds) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
  credentials = creds;
}

function clearStoredCredentials() {
  localStorage.removeItem(STORAGE_KEY);
  credentials = null;
}

function showAuthScreen() {
  els.authScreen.classList.remove('hidden');
  els.mainApp.classList.add('hidden');
}

function showMainApp() {
  els.authScreen.classList.add('hidden');
  els.mainApp.classList.remove('hidden');
  if (credentials) {
    els.projectId.textContent = credentials.project_id;
    if (els.settingsProjectId) els.settingsProjectId.textContent = credentials.project_id;
    if (els.settingsServiceAccount) els.settingsServiceAccount.textContent = credentials.client_email;
  }
}

// ─── API ────────────────────────────────────────────────────────────────────
async function apiPost(path, body = {}) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credentials, ...body }),
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

async function fetchRepositories() {
  if (!credentials) return;
  els.repoList.innerHTML = `
    <div class="skeleton-list">
      <div class="skeleton-row"></div>
      <div class="skeleton-row"></div>
      <div class="skeleton-row"></div>
    </div>`;

  try {
    const data = await apiPost('/api/repositories');
    repositories = data.repositories || [];
    repoPage = 1;
    updateStats();
    renderRepoList();
    populateRepoSelects();
    showToast(`Loaded ${repositories.length} repositories`);
  } catch (error) {
    els.repoList.innerHTML = `<div class="empty-state"><p>Error: ${escapeHtml(error.message)}</p></div>`;
  }
}

async function fetchRepoMeta(location, name) {
  try {
    const data = await apiPost(`/api/repositories/${location}/${name}`);
    return data.repository;
  } catch {
    return (
      repositories.find((r) => r.location === location && r.name === name) || {
        name,
        location,
        format: 'DOCKER',
        description: '',
      }
    );
  }
}

async function fetchDockerImagesPage({ location, name, pageToken = null, range = '7d' }) {
  const since = sinceForRange(range);
  return apiPost(`/api/repositories/${location}/${name}/docker-images`, {
    pageSize: IMAGE_PAGE_SIZE,
    pageToken: pageToken || undefined,
    orderBy: 'upload_time desc',
    since: since || undefined,
  });
}

async function fetchPackagesPage({ location, name, pageToken = null }) {
  return apiPost(`/api/repositories/${location}/${name}/packages`, {
    pageSize: IMAGE_PAGE_SIZE,
    pageToken: pageToken || undefined,
    orderBy: 'update_time desc',
  });
}

// ─── Routing ────────────────────────────────────────────────────────────────
function parseHash() {
  const raw = (location.hash || '#/repositories').replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);

  if (!parts.length || parts[0] === 'repositories') return { name: 'repositories' };
  if (parts[0] === 'repo' && parts[1] && parts[2]) {
    return {
      name: 'repo',
      location: decodeURIComponent(parts[1]),
      repo: decodeURIComponent(parts[2]),
    };
  }
  if (['upload', 'download', 'settings'].includes(parts[0])) return { name: parts[0] };
  return { name: 'repositories' };
}

function navigate(path) {
  if (!path.startsWith('#/')) path = '#/' + path.replace(/^\//, '');
  if (location.hash === path) handleRoute();
  else location.hash = path;
}

function setActiveNav(routeName) {
  document.querySelectorAll('.nav-item').forEach((item) => {
    const r = item.dataset.route;
    item.classList.toggle('active', r === routeName || (routeName === 'repo' && r === 'repositories'));
  });
}

function showView(viewId) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  const el = $(viewId);
  if (el) el.classList.add('active');
}

function setHeader({ title, subtitle, crumbs = [] }) {
  els.pageTitle.textContent = title;
  els.pageSubtitle.textContent = subtitle;
  if (!crumbs.length) {
    els.breadcrumbs.innerHTML = '';
    els.breadcrumbs.classList.add('hidden');
  } else {
    els.breadcrumbs.classList.remove('hidden');
    els.breadcrumbs.innerHTML = crumbs
      .map((c, i) => {
        const isLast = i === crumbs.length - 1;
        if (isLast || !c.href) {
          return `<span class="crumb current">${escapeHtml(c.label)}</span>`;
        }
        return `<a class="crumb" href="${c.href}">${escapeHtml(c.label)}</a><span class="crumb-sep">/</span>`;
      })
      .join('');
  }
}

async function handleRoute() {
  if (!credentials) return;
  closeModal();
  const route = parseHash();

  if (route.name === 'repositories') {
    setActiveNav('repositories');
    showView('repositoriesView');
    setHeader({
      title: 'Repositories',
      subtitle: 'Browse repositories — open one to inspect images & tags',
      crumbs: [{ label: 'Repositories' }],
    });
    if (!repositories.length) await fetchRepositories();
    else renderRepoList();
    return;
  }

  if (route.name === 'repo') {
    setActiveNav('repo');
    showView('repoDetailView');
    setHeader({
      title: route.repo,
      subtitle: route.location,
      crumbs: [
        { label: 'Repositories', href: '#/repositories' },
        { label: route.repo },
      ],
    });
    await openRepoPage(route.location, route.repo);
    return;
  }

  if (route.name === 'upload') {
    setActiveNav('upload');
    showView('uploadView');
    setHeader({
      title: 'Upload from Docker Hub',
      subtitle: 'Transfer public images into your Artifact Registry',
      crumbs: [{ label: 'Upload' }],
    });
    cancelTransferSelection();
    fetchPopularImages();
    if (!repositories.length) await fetchRepositories();
    return;
  }

  if (route.name === 'download') {
    setActiveNav('download');
    showView('downloadView');
    setHeader({
      title: 'Download',
      subtitle: 'Generate pull commands for images in your registry',
      crumbs: [{ label: 'Download' }],
    });
    if (!repositories.length) await fetchRepositories();
    return;
  }

  if (route.name === 'settings') {
    setActiveNav('settings');
    showView('settingsView');
    setHeader({
      title: 'Settings',
      subtitle: 'Manage credentials and preferences',
      crumbs: [{ label: 'Settings' }],
    });
  }
}

// ─── Repositories list ──────────────────────────────────────────────────────
function updateStats() {
  const docker = repositories.filter((r) => r.format === 'DOCKER').length;
  els.totalRepos.textContent = repositories.length;
  els.dockerRepos.textContent = docker;
  els.otherRepos.textContent = repositories.length - docker;
}

function filteredRepos() {
  const q = repoSearchQuery.toLowerCase().trim();
  if (!q) return repositories;
  return repositories.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      (r.format || '').toLowerCase().includes(q) ||
      (r.location || '').toLowerCase().includes(q) ||
      (r.description || '').toLowerCase().includes(q)
  );
}

function renderRepoList() {
  const list = filteredRepos();
  const totalPages = Math.max(1, Math.ceil(list.length / REPO_PAGE_SIZE));
  if (repoPage > totalPages) repoPage = totalPages;
  const start = (repoPage - 1) * REPO_PAGE_SIZE;
  const pageItems = list.slice(start, start + REPO_PAGE_SIZE);

  if (!list.length) {
    els.repoList.innerHTML = `<div class="empty-state"><p>${
      repoSearchQuery ? 'No repositories match your search' : 'No repositories found'
    }</p></div>`;
    els.repoPagination.innerHTML = '';
    return;
  }

  els.repoList.innerHTML = pageItems
    .map(
      (repo) => `
    <a class="repo-card" href="#/repo/${encodeURIComponent(repo.location)}/${encodeURIComponent(repo.name)}">
      <div class="repo-card-main">
        <div class="repo-card-icon ${getFormatBadgeClass(repo.format)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
        </div>
        <div class="repo-card-text">
          <div class="repo-card-title-row">
            <h4>${escapeHtml(repo.name)}</h4>
            <span class="format-badge ${getFormatBadgeClass(repo.format)}">${escapeHtml(repo.format)}</span>
          </div>
          <p class="repo-card-desc">${escapeHtml(repo.description || 'No description')}</p>
          <div class="repo-card-meta">
            <span>${escapeHtml(repo.location)}</span>
            <span class="dot">·</span>
            <span title="${escapeHtml(formatDate(repo.updatedAt || repo.createdAt))}">
              Updated ${escapeHtml(relativeDate(repo.updatedAt || repo.createdAt))}
            </span>
            ${
              repo.sizeFormatted && repo.sizeFormatted !== 'N/A'
                ? `<span class="dot">·</span><span>${escapeHtml(repo.sizeFormatted)}</span>`
                : ''
            }
          </div>
        </div>
      </div>
      <div class="repo-card-arrow">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </div>
    </a>`
    )
    .join('');

  renderPagination(els.repoPagination, {
    page: repoPage,
    totalPages,
    total: list.length,
    pageSize: REPO_PAGE_SIZE,
    onPage: (p) => {
      repoPage = p;
      renderRepoList();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });
}

function renderPagination(container, { page, totalPages, total, pageSize, onPage }) {
  if (!container) return;
  if (totalPages <= 1) {
    container.innerHTML = total
      ? `<span class="pagination-info">Showing ${total} item${total === 1 ? '' : 's'}</span>`
      : '';
    return;
  }

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  container.innerHTML = `
    <span class="pagination-info">${from}–${to} of ${total}</span>
    <div class="pagination-controls">
      <button class="btn btn-outline btn-sm page-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} type="button">Previous</button>
      <span class="page-indicator">Page ${page} / ${totalPages}</span>
      <button class="btn btn-outline btn-sm page-btn" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''} type="button">Next</button>
    </div>`;

  container.querySelectorAll('.page-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.page, 10);
      if (p >= 1 && p <= totalPages) onPage(p);
    });
  });
}

// ─── Repo detail ────────────────────────────────────────────────────────────
async function openRepoPage(location, name) {
  const isSame = repoDetail.location === location && repoDetail.name === name;
  repoDetail.location = location;
  repoDetail.name = name;

  if (!isSame) {
    repoDetail.images = [];
    repoDetail.packages = [];
    repoDetail.nextPageToken = null;
    repoDetail.reachedEnd = false;
    repoDetail.search = '';
    if (els.imageSearch) {
      els.imageSearch.value = '';
      syncSearchClear('imageSearch');
    }
  }

  els.timeFilters.querySelectorAll('.seg').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.range === repoDetail.range);
  });

  els.repoDetailHeader.innerHTML = `
    <div class="repo-hero">
      <div class="skeleton-row" style="margin:0;height:1rem;width:40%"></div>
      <div class="skeleton-row" style="margin:12px 0 0;height:1.4rem;width:55%"></div>
    </div>`;
  els.timelineContainer.innerHTML = `
    <div class="empty-state">
      <div class="spinner"></div>
      <p>Loading artifacts…</p>
    </div>`;
  els.timelineMeta.textContent = '';
  els.loadMoreWrap.hidden = true;

  const meta = await fetchRepoMeta(location, name);
  repoDetail.meta = meta;
  repoDetail.format = meta.format || 'DOCKER';

  els.repoDetailHeader.innerHTML = `
    <div class="repo-hero">
      <div class="repo-hero-top">
        <span class="format-badge ${getFormatBadgeClass(meta.format)}">${escapeHtml(meta.format || 'UNKNOWN')}</span>
        <span class="pill">${escapeHtml(location)}</span>
      </div>
      <h2 class="repo-hero-name">${escapeHtml(name)}</h2>
      <p class="repo-hero-desc">${escapeHtml(meta.description || 'No description provided')}</p>
      <div class="repo-hero-stats">
        <div class="mini-stat">
          <span class="mini-label">Updated</span>
          <span class="mini-value" title="${escapeHtml(formatDate(meta.updatedAt))}">${escapeHtml(relativeDate(meta.updatedAt || meta.createdAt))}</span>
        </div>
        <div class="mini-stat">
          <span class="mini-label">Created</span>
          <span class="mini-value">${escapeHtml(formatDate(meta.createdAt))}</span>
        </div>
        <div class="mini-stat">
          <span class="mini-label">Size</span>
          <span class="mini-value">${escapeHtml(meta.sizeFormatted || 'N/A')}</span>
        </div>
      </div>
    </div>`;

  setHeader({
    title: name,
    subtitle: `${meta.format || 'Repository'} · ${location}`,
    crumbs: [
      { label: 'Repositories', href: '#/repositories' },
      { label: name },
    ],
  });

  repoDetail.images = [];
  repoDetail.packages = [];
  repoDetail.nextPageToken = null;
  repoDetail.reachedEnd = false;
  await loadRepoArtifacts({ reset: true });
}

async function loadRepoArtifacts({ reset = false } = {}) {
  if (repoDetail.loading) return;
  if (!reset && repoDetail.reachedEnd) return;

  repoDetail.loading = true;
  if (reset) {
    els.timelineContainer.innerHTML = `
      <div class="empty-state">
        <div class="spinner"></div>
        <p>Fetching newest artifacts…</p>
      </div>`;
    els.loadMoreWrap.hidden = true;
  } else {
    els.loadMoreBtn.disabled = true;
    els.loadMoreBtn.textContent = 'Loading…';
  }

  try {
    const isDocker = (repoDetail.format || '').toUpperCase().includes('DOCKER');

    if (isDocker) {
      const data = await fetchDockerImagesPage({
        location: repoDetail.location,
        name: repoDetail.name,
        pageToken: reset ? null : repoDetail.nextPageToken,
        range: repoDetail.range,
      });
      const incoming = data.images || [];
      const seen = new Set(repoDetail.images.map((i) => i.id));
      incoming.forEach((img) => {
        if (!seen.has(img.id)) {
          repoDetail.images.push(img);
          seen.add(img.id);
        }
      });
      repoDetail.nextPageToken = data.nextPageToken || null;
      repoDetail.reachedEnd = !data.nextPageToken || data.reachedCutoff;
    } else {
      const data = await fetchPackagesPage({
        location: repoDetail.location,
        name: repoDetail.name,
        pageToken: reset ? null : repoDetail.nextPageToken,
      });
      const incoming = data.packages || [];
      const seen = new Set(repoDetail.packages.map((p) => p.id));
      incoming.forEach((pkg) => {
        if (!seen.has(pkg.id)) {
          repoDetail.packages.push(pkg);
          seen.add(pkg.id);
        }
      });
      repoDetail.nextPageToken = data.nextPageToken || null;
      repoDetail.reachedEnd = !data.nextPageToken;
    }

    renderTimeline();
  } catch (error) {
    els.timelineContainer.innerHTML = `
      <div class="empty-state">
        <p>Failed to load: ${escapeHtml(error.message)}</p>
      </div>`;
  } finally {
    repoDetail.loading = false;
    els.loadMoreBtn.disabled = false;
    els.loadMoreBtn.textContent = 'Load more';
    els.loadMoreWrap.hidden = repoDetail.reachedEnd;
  }
}

function getFilteredGroups() {
  const isDocker = (repoDetail.format || '').toUpperCase().includes('DOCKER');
  const q = (repoDetail.search || '').toLowerCase().trim();

  if (isDocker) {
    let groups = groupDockerImages(repoDetail.images);
    if (q) {
      groups = groups.filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          g.allTags.some((t) => t.toLowerCase().includes(q))
      );
    }
    const asItems = groups.map((g) => ({
      ...g,
      uploadedAt: g.latestUpload,
      _type: 'image',
    }));
    return groupByTimeBucket(asItems, 'uploadedAt');
  }

  let pkgs = repoDetail.packages;
  if (q) pkgs = pkgs.filter((p) => p.name.toLowerCase().includes(q));
  const asItems = pkgs.map((p) => ({
    ...p,
    uploadedAt: p.updatedAt || p.createdAt,
    _type: 'package',
  }));
  return groupByTimeBucket(asItems, 'uploadedAt');
}

function renderTimeline() {
  const isDocker = (repoDetail.format || '').toUpperCase().includes('DOCKER');
  const buckets = getFilteredGroups();
  const totalLoaded = isDocker ? repoDetail.images.length : repoDetail.packages.length;
  const rangeLabel = {
    '24h': 'last 24 hours',
    '7d': 'last 7 days',
    '30d': 'last 30 days',
    '90d': 'last 90 days',
    all: 'all time',
  }[repoDetail.range];

  const groupCount = buckets.reduce((n, b) => n + b.items.length, 0);

  els.timelineMeta.innerHTML = `
    <span>Showing <strong>${groupCount}</strong> ${isDocker ? 'image group' : 'package'}${groupCount === 1 ? '' : 's'}
    from <strong>${totalLoaded}</strong> loaded
    · <strong>${rangeLabel}</strong>
    ${repoDetail.search ? ` · filtered by “${escapeHtml(repoDetail.search)}”` : ''}
    ${repoDetail.reachedEnd ? '' : ' · more available'}</span>`;

  if (!buckets.length) {
    els.timelineContainer.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.35-4.35"></path>
        </svg>
        <p>${repoDetail.search ? 'No matches for this filter' : 'No artifacts in this time range'}</p>
        <p class="muted-hint">${repoDetail.search ? 'Clear search or widen the time range' : 'Try a wider range or load more'}</p>
      </div>`;
    return;
  }

  if (isDocker) {
    els.timelineContainer.innerHTML = buckets
      .map(
        (bucket) => `
      <section class="time-section">
        <header class="time-section-header">
          <h3>${escapeHtml(bucket.label)}</h3>
          <span class="time-section-count">${bucket.items.length}</span>
        </header>
        <div class="artifact-list">
          ${bucket.items
            .map((group) => {
              const tags = group.allTags || [];
              const visible = tags.slice(0, 5);
              const digests = buildTagDigestGroups(group.variants);
              const latestDig = digests[0];
              return `
              <article class="artifact-row" data-image="${escapeHtml(group.name)}">
                <div class="artifact-main" role="button" tabindex="0">
                  <div class="artifact-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                      <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                    </svg>
                  </div>
                  <div class="artifact-body">
                    <div class="artifact-title-row">
                      <h4>${escapeHtml(group.name)}</h4>
                      <span class="relative-time" title="${escapeHtml(formatDate(group.latestUpload))}">
                        ${escapeHtml(relativeDate(group.latestUpload))}
                      </span>
                    </div>
                    <div class="artifact-tags">
                      ${
                        visible.length
                          ? visible.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')
                          : '<span class="tag muted">untagged</span>'
                      }
                      ${tags.length > 5 ? `<span class="tag more">+${tags.length - 5}</span>` : ''}
                    </div>
                    <div class="artifact-meta-row">
                      <span>${digests.length} commit${digests.length === 1 ? '' : 's'}</span>
                      <span class="dot">·</span>
                      <span>${tags.length} tag${tags.length === 1 ? '' : 's'}</span>
                      ${
                        latestDig?.shortDigest
                          ? `<span class="dot">·</span><span class="mono-meta" title="${escapeHtml(latestDig.digest || '')}">${escapeHtml(latestDig.shortDigest)}</span>`
                          : ''
                      }
                      <span class="dot">·</span>
                      <span>${escapeHtml(formatSize(group.totalSize))}</span>
                    </div>
                  </div>
                  <div class="artifact-chevron">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                  </div>
                </div>
              </article>`;
            })
            .join('')}
        </div>
      </section>`
      )
      .join('');

    els.timelineContainer.querySelectorAll('.artifact-row').forEach((row) => {
      const open = () => openImageModal(row.dataset.image);
      row.querySelector('.artifact-main').addEventListener('click', open);
      row.querySelector('.artifact-main').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    });
  } else {
    els.timelineContainer.innerHTML = buckets
      .map(
        (bucket) => `
      <section class="time-section">
        <header class="time-section-header">
          <h3>${escapeHtml(bucket.label)}</h3>
          <span class="time-section-count">${bucket.items.length}</span>
        </header>
        <div class="artifact-list">
          ${bucket.items
            .map(
              (pkg) => `
            <article class="artifact-row package-row">
              <div class="artifact-main">
                <div class="artifact-icon package">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                  </svg>
                </div>
                <div class="artifact-body">
                  <div class="artifact-title-row">
                    <h4>${escapeHtml(pkg.name)}</h4>
                    <span class="relative-time">${escapeHtml(relativeDate(pkg.updatedAt || pkg.createdAt))}</span>
                  </div>
                  <div class="artifact-meta-row">
                    <span>Created ${escapeHtml(formatDate(pkg.createdAt))}</span>
                  </div>
                </div>
              </div>
            </article>`
            )
            .join('')}
        </div>
      </section>`
      )
      .join('');
  }
}

// ─── Full-screen image modal ────────────────────────────────────────────────
function openImageModal(imageName) {
  const groups = groupDockerImages(repoDetail.images);
  const group = groups.find((g) => g.name === imageName);
  if (!group) return;

  const location = repoDetail.location;
  const repository = repoDetail.name;

  // Digest groups sorted by update time — one group = one image build
  const digestGroups = buildTagDigestGroups(group.variants);
  const channels = discoverChannels(digestGroups);
  const allTagNames = digestGroups.flatMap((g) => g.tags);

  const authCmd = `gcloud auth configure-docker ${location}-docker.pkg.dev --quiet`;

  // View: 'all' | channel family name (main, bh-dev, …)
  let activeView = channels[0]?.family || 'all';
  let digPage = 0;
  let tagQuery = '';
  const DIG_PAGE = 10;

  els.modalTitle.textContent = imageName;
  els.modalSubtitle.textContent = `${repository} · ${location}`;
  els.modalBadge.textContent = `${channels.length} channels · ${digestGroups.length} builds`;
  els.modalBadge.className = 'badge docker';

  function enrichGroup(g) {
    const gitCommit = getGitCommitFromGroup(g);
    return {
      ...g,
      gitCommit,
      gitShort: gitCommit ? gitCommit.slice(0, 12) : null,
    };
  }

  function renderBuildCard(g, { badge, channelForRetag } = {}) {
    const e = enrichGroup(g);
    const when = e.updatedAt || e.uploadedAt;
    const pullDigest = generatePullByDigest(location, repository, imageName, e.digest);
    const pullGit = e.gitCommit
      ? generatePullCommand(location, repository, imageName, e.gitCommit)
      : null;
    const channelTags = (e.tags || []).filter(isChannelTag);
    const retagCmd =
      channelForRetag && e.digest
        ? generateRetagChannelCommands(
            location,
            repository,
            imageName,
            e.digest,
            channelForRetag,
            channels.find((c) => c.family === channelForRetag)?.aliasTags || []
          )
        : null;

    return `
      <article class="digest-card ${badge === 'current' ? 'is-newest' : ''} ${badge === 'previous' ? 'is-previous' : ''}">
        <header class="digest-card-head">
          <div class="digest-card-title">
            ${badge === 'current' ? '<span class="pill-live">Current</span>' : ''}
            ${badge === 'previous' ? '<span class="pill-prev">Previous</span>' : ''}
            ${badge === 'older' ? '<span class="pill-older">Older</span>' : ''}
            <span class="digest-time" title="${escapeHtml(formatDate(when))}">
              ${escapeHtml(relativeDate(when))}
              <span class="digest-time-abs">· ${escapeHtml(formatDate(when))}</span>
            </span>
          </div>
          <span class="digest-size">${escapeHtml(e.sizeFormatted || 'N/A')}</span>
        </header>

        <div class="digest-id-row">
          <span class="digest-label">Git commit</span>
          ${
            e.gitCommit
              ? `<code class="digest-id git" title="${escapeHtml(e.gitCommit)}">${escapeHtml(e.gitShort)}<span class="digest-id-rest">${escapeHtml(e.gitCommit.slice(12))}</span></code>
                 <button class="btn btn-ghost btn-sm" type="button" data-copy="${escapeHtml(e.gitCommit)}">Copy</button>`
              : `<span class="muted-hint">No git-sha tag on this build</span>`
          }
        </div>

        <div class="digest-id-row">
          <span class="digest-label">Digest</span>
          <code class="digest-id" title="${escapeHtml(e.digest || '')}">${escapeHtml(e.shortDigest || '—')}<span class="digest-id-rest">${escapeHtml(
            e.digest && e.digest.startsWith('sha256:') ? e.digest.slice(7 + 12) : ''
          )}</span></code>
          <button class="btn btn-ghost btn-sm" type="button" data-copy="${escapeHtml(e.digest || '')}">Copy</button>
        </div>

        ${
          channelTags.length
            ? `<div class="digest-tags-row">
                <span class="digest-label">Channels</span>
                <div class="digest-tags">${channelTags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
              </div>`
            : ''
        }

        <div class="digest-actions">
          <button class="btn btn-primary btn-sm" type="button" data-copy="${escapeHtml(pullDigest)}" title="Immutable image digest">
            Pull by digest
          </button>
          ${
            pullGit
              ? `<button class="btn btn-outline btn-sm" type="button" data-copy="${escapeHtml(pullGit)}" title="Pull git commit tag">
                  Pull :${escapeHtml(e.gitShort)}
                </button>`
              : ''
          }
          ${
            retagCmd
              ? `<button class="btn btn-outline btn-sm" type="button" data-copy="${escapeHtml(retagCmd)}" title="Pull + retag channel to this build">
                  Retag as ${escapeHtml(channelForRetag)}
                </button>`
              : ''
          }
        </div>
      </article>`;
  }

  function wireCopy(root) {
    root?.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', () => copyToClipboard(btn.dataset.copy));
    });
  }

  function renderChannelView(family) {
    const el = els.modalBody.querySelector('#modalMainView');
    if (!el) return;

    const ch = channels.find((c) => c.family === family);
    const { current, previous, older } = channelRollbackCandidates(family, digestGroups);
    const primary = ch?.primaryTag || family;
    const aliases = ch?.aliasTags || [family];

    if (!current) {
      el.innerHTML = `<div class="empty-state"><p>No build currently tagged <strong>${escapeHtml(family)}</strong></p></div>`;
      return;
    }

    const currentGit = getGitCommitFromGroup(current);
    const prevGit = previous ? getGitCommitFromGroup(previous) : null;
    const pullCurrentTag = generatePullCommand(location, repository, imageName, primary);
    const pullCurrentDigest = generatePullByDigest(location, repository, imageName, current.digest);
    const pullPrevDigest = previous
      ? generatePullByDigest(location, repository, imageName, previous.digest)
      : null;
    const retagPrev = previous
      ? generateRetagChannelCommands(location, repository, imageName, previous.digest, family, aliases)
      : null;

    const olderSlice = older.slice(0, (digPage + 1) * DIG_PAGE);

    el.innerHTML = `
      <div class="channel-hero">
        <div class="channel-hero-top">
          <h3 class="channel-hero-title">
            <span class="tag channel-pill">${escapeHtml(primary)}</span>
            channel
          </h3>
          <p class="modal-panel-desc" style="margin:0.35rem 0 0">
            Pull <strong>current</strong> ${escapeHtml(primary)}, or roll back to the <strong>previous</strong> build / any older commit.
            Registry only stores the current tag — older builds stay available via git-sha tags + digests.
          </p>
        </div>

        <div class="channel-quick-grid">
          <div class="channel-quick-card current">
            <div class="channel-quick-label">Current ${escapeHtml(primary)}</div>
            <div class="channel-quick-meta">
              ${currentGit ? `<code class="mono-tag">${escapeHtml(currentGit.slice(0, 12))}</code>` : '<span class="muted-hint">no git tag</span>'}
              <span class="dot">·</span>
              <span>${escapeHtml(relativeDate(current.updatedAt || current.uploadedAt))}</span>
            </div>
            <div class="digest-actions" style="border:0;padding-top:0.5rem;margin-top:0.35rem">
              <button class="btn btn-primary btn-sm" type="button" data-copy="${escapeHtml(pullCurrentTag)}">Pull :${escapeHtml(primary)}</button>
              <button class="btn btn-outline btn-sm" type="button" data-copy="${escapeHtml(pullCurrentDigest)}">Pull digest</button>
            </div>
          </div>

          <div class="channel-quick-card previous ${previous ? '' : 'empty'}">
            <div class="channel-quick-label">Previous ${escapeHtml(primary)}</div>
            ${
              previous
                ? `<div class="channel-quick-meta">
                    ${prevGit ? `<code class="mono-tag">${escapeHtml(prevGit.slice(0, 12))}</code>` : '<span class="muted-hint">no git tag</span>'}
                    <span class="dot">·</span>
                    <span>${escapeHtml(relativeDate(previous.updatedAt || previous.uploadedAt))}</span>
                  </div>
                  <div class="digest-actions" style="border:0;padding-top:0.5rem;margin-top:0.35rem">
                    <button class="btn btn-primary btn-sm" type="button" data-copy="${escapeHtml(pullPrevDigest)}">Pull previous</button>
                    ${
                      prevGit
                        ? `<button class="btn btn-outline btn-sm" type="button" data-copy="${escapeHtml(
                            generatePullCommand(location, repository, imageName, prevGit)
                          )}">Pull :${escapeHtml(prevGit.slice(0, 12))}</button>`
                        : ''
                    }
                    <button class="btn btn-outline btn-sm" type="button" data-copy="${escapeHtml(retagPrev)}">Retag ${escapeHtml(primary)} → previous</button>
                  </div>`
                : `<p class="muted-hint" style="margin-top:0.5rem">No older build found that isn’t owned by another channel. Load more image history or pick from “Older builds” below.</p>`
            }
          </div>
        </div>
      </div>

      <div class="command-panel" style="margin-top:1rem">
        <h4 class="panel-title">Auth (once)</h4>
        <code class="code-block">${escapeHtml(authCmd)}</code>
        <button class="btn btn-ghost btn-sm" type="button" data-copy="${escapeHtml(authCmd)}">Copy</button>
      </div>

      <section class="channel-section">
        <h4 class="section-title">Current build</h4>
        ${renderBuildCard(current, { badge: 'current', channelForRetag: null })}
      </section>

      ${
        previous
          ? `<section class="channel-section">
              <h4 class="section-title">Previous build <span class="muted-hint">(suggested rollback)</span></h4>
              ${renderBuildCard(previous, { badge: 'previous', channelForRetag: family })}
            </section>`
          : ''
      }

      ${
        older.length
          ? `<section class="channel-section">
              <h4 class="section-title">Older builds <span class="count">${older.length}</span></h4>
              <p class="modal-panel-desc">Pick any commit to pull, or retag ${escapeHtml(primary)} onto it for a full channel rollback.</p>
              <div class="digest-list">
                ${olderSlice.map((g) => renderBuildCard(g, { badge: 'older', channelForRetag: family })).join('')}
              </div>
              ${
                olderSlice.length < older.length
                  ? `<button class="btn btn-outline btn-sm" id="moreDigestsBtn" type="button" style="margin-top:0.75rem;width:100%">
                      Show more (${older.length - olderSlice.length} left)
                    </button>`
                  : ''
              }
            </section>`
          : `<section class="channel-section">
              <h4 class="section-title">Older builds <span class="count">0</span></h4>
              <p class="muted-hint">No older builds yet — pull an older commit from “All builds”, or load more image history.</p>
            </section>`
      }`;

    wireCopy(el);
    el.querySelector('#moreDigestsBtn')?.addEventListener('click', () => {
      digPage += 1;
      renderChannelView(family);
    });
  }

  function renderAllView() {
    const el = els.modalBody.querySelector('#modalMainView');
    if (!el) return;

    const q = tagQuery.toLowerCase().trim();
    let list = digestGroups;
    if (q) {
      list = digestGroups.filter(
        (g) =>
          g.tags.some((t) => t.toLowerCase().includes(q)) ||
          (g.digest || '').toLowerCase().includes(q) ||
          (getGitCommitFromGroup(g) || '').toLowerCase().includes(q)
      );
    }
    const slice = list.slice(0, (digPage + 1) * DIG_PAGE);

    el.innerHTML = `
      <div class="digest-list-hint">
        All builds newest-first. Open a <strong>channel</strong> tab (main, bh-dev, …) to pull current / previous for that track.
      </div>
      <div class="search-field" style="margin-bottom:0.85rem;min-width:0;width:100%;max-width:28rem">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.35-4.35"></path>
        </svg>
        <input type="search" id="modalTagSearch" class="search-input" placeholder="Search tags, git commit, digest…" autocomplete="off" value="${escapeHtml(tagQuery)}">
      </div>
      <div class="digest-list">
        ${
          slice.length
            ? slice
                .map((g, idx) =>
                  renderBuildCard(g, {
                    badge: idx === 0 && !q && digPage === 0 ? 'current' : null,
                  })
                )
                .join('')
            : `<div class="empty-state" style="padding:1.5rem"><p>No builds match</p></div>`
        }
      </div>
      ${
        slice.length < list.length
          ? `<button class="btn btn-outline btn-sm" id="moreDigestsBtn" type="button" style="margin-top:0.75rem;width:100%">
              Show more (${list.length - slice.length} left)
            </button>`
          : ''
      }`;

    wireCopy(el);
    el.querySelector('#modalTagSearch')?.addEventListener('input', (e) => {
      tagQuery = e.target.value;
      digPage = 0;
      renderAllView();
    });
    el.querySelector('#moreDigestsBtn')?.addEventListener('click', () => {
      digPage += 1;
      renderAllView();
    });
  }

  function renderActive() {
    digPage = 0;
    if (activeView === 'all') renderAllView();
    else renderChannelView(activeView);
  }

  function setActiveTab(view) {
    activeView = view;
    tagQuery = '';
    els.modalBody.querySelectorAll('.channel-tab').forEach((btn) => {
      const selected = btn.dataset.view === view;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-selected', String(selected));
    });
    renderActive();
  }

  const channelTabs = [
    { view: 'all', label: 'All builds' },
    ...channels.map((c) => ({ view: c.family, label: c.primaryTag || c.family })),
  ];

  // Default to first channel if any (bh-dev / main), else all
  if (channels.length) {
    // Prefer common channel names
    const preferred = ['bh-dev', 'main', 'dev', 'prod', 'staging'];
    activeView =
      preferred.find((p) => channels.some((c) => c.family === p)) || channels[0].family;
  } else {
    activeView = 'all';
  }

  els.modalBody.innerHTML = `
    <div class="modal-grid">
      <div class="modal-panel modal-span-2 channel-tabs-wrap">
        <div class="channel-tabs" role="tablist" aria-label="Channels">
          ${channelTabs
            .map(
              (t) => `
            <button type="button" class="channel-tab ${t.view === activeView ? 'active' : ''}" data-view="${escapeHtml(t.view)}" role="tab" aria-selected="${t.view === activeView ? 'true' : 'false'}">
              ${escapeHtml(t.label)}
            </button>`
            )
            .join('')}
        </div>
        <p class="modal-panel-desc" style="margin-top:0.75rem;margin-bottom:0">
          Use <strong>main</strong> / <strong>bh-dev</strong> tabs for “current vs previous” on that channel. Git-sha tags stay on old builds for rollback.
        </p>
      </div>
      <div class="modal-panel modal-span-2" id="modalMainView"></div>
    </div>`;

  els.modalBody.querySelectorAll('.channel-tab').forEach((btn) => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.view));
  });

  renderActive();
  showModal();
}

let modalOpener = null;

function showModal() {
  modalOpener = document.activeElement instanceof Element ? document.activeElement : null;
  els.imageModal.classList.remove('hidden');
  els.imageModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  els.modalClose?.focus();
}

function closeModal() {
  if (!els.imageModal || els.imageModal.classList.contains('hidden')) return;
  els.imageModal.classList.add('hidden');
  els.imageModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  if (modalOpener?.isConnected) modalOpener.focus();
  modalOpener = null;
}

// ─── Command palette ────────────────────────────────────────────────────────
function buildCmdItems(query) {
  const q = (query || '').toLowerCase().trim();
  const items = [];

  const pages = [
    { id: 'p-repos', title: 'Repositories', sub: 'Browse all repositories', href: '#/repositories', group: 'Navigate' },
    { id: 'p-upload', title: 'Upload', sub: 'Transfer from Docker Hub', href: '#/upload', group: 'Navigate' },
    { id: 'p-download', title: 'Download', sub: 'Generate pull commands', href: '#/download', group: 'Navigate' },
    { id: 'p-settings', title: 'Settings', sub: 'Credentials & account', href: '#/settings', group: 'Navigate' },
  ];

  pages.forEach((p) => {
    if (!q || p.title.toLowerCase().includes(q) || p.sub.toLowerCase().includes(q)) {
      items.push(p);
    }
  });

  const repos = repositories
    .filter((r) => {
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.location || '').toLowerCase().includes(q) ||
        (r.format || '').toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q)
      );
    })
    .slice(0, 12)
    .map((r) => ({
      id: `r-${r.location}-${r.name}`,
      title: r.name,
      sub: `${r.format} · ${r.location}`,
      href: `#/repo/${encodeURIComponent(r.location)}/${encodeURIComponent(r.name)}`,
      group: 'Repositories',
    }));

  items.push(...repos);

  // On repo page: jump to filter
  if (repoDetail.name && q) {
    items.unshift({
      id: 'filter-images',
      title: `Filter images for “${query}”`,
      sub: `In ${repoDetail.name}`,
      action: 'filter-images',
      query,
      group: 'Actions',
    });
  }

  return items;
}

function openCmdPalette() {
  if (!credentials) return;
  els.cmdPalette.classList.remove('hidden');
  els.cmdPalette.setAttribute('aria-hidden', 'false');
  document.body.classList.add('cmd-open');
  els.cmdInput.value = '';
  cmdActive = 0;
  renderCmdResults('');
  setTimeout(() => els.cmdInput.focus(), 10);
}

function closeCmdPalette() {
  if (!els.cmdPalette || els.cmdPalette.classList.contains('hidden')) return;
  els.cmdPalette.classList.add('hidden');
  els.cmdPalette.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('cmd-open');
}

function renderCmdResults(query) {
  cmdItems = buildCmdItems(query);
  if (cmdActive >= cmdItems.length) cmdActive = Math.max(0, cmdItems.length - 1);

  if (!cmdItems.length) {
    els.cmdResults.innerHTML = `<div class="cmd-empty">No results for “${escapeHtml(query)}”</div>`;
    return;
  }

  let html = '';
  let lastGroup = null;
  cmdItems.forEach((item, i) => {
    if (item.group !== lastGroup) {
      lastGroup = item.group;
      html += `<div class="cmd-group-label">${escapeHtml(item.group)}</div>`;
    }
    html += `
      <button type="button" class="cmd-item ${i === cmdActive ? 'active' : ''}" data-index="${i}">
        <span class="cmd-item-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
        </span>
        <span class="cmd-item-main">
          <span class="cmd-item-title">${escapeHtml(item.title)}</span>
          <span class="cmd-item-sub">${escapeHtml(item.sub || '')}</span>
        </span>
      </button>`;
  });
  els.cmdResults.innerHTML = html;

  els.cmdResults.querySelectorAll('.cmd-item').forEach((btn) => {
    btn.addEventListener('mouseenter', () => {
      cmdActive = parseInt(btn.dataset.index, 10);
      els.cmdResults.querySelectorAll('.cmd-item').forEach((b, i) => {
        b.classList.toggle('active', i === cmdActive);
      });
    });
    btn.addEventListener('click', () => runCmdItem(cmdItems[parseInt(btn.dataset.index, 10)]));
  });
}

function runCmdItem(item) {
  if (!item) return;
  closeCmdPalette();
  if (item.action === 'filter-images') {
    if (els.imageSearch) {
      els.imageSearch.value = item.query || '';
      repoDetail.search = item.query || '';
      syncSearchClear('imageSearch');
      renderTimeline();
      els.imageSearch.focus();
    }
    return;
  }
  if (item.href) navigate(item.href);
}

// ─── Upload / Docker Hub ────────────────────────────────────────────────────
async function fetchPopularImages() {
  try {
    const response = await fetch('/api/dockerhub/popular');
    const data = await response.json();
    renderPopularImages(data.images || []);
  } catch (e) {
    console.error(e);
  }
}

function renderPopularImages(images) {
  if (!els.popularGrid) return;
  els.popularGrid.innerHTML = images
    .map(
      (img) => `
    <div class="popular-card" data-image="${escapeHtml(img.name)}">
      <div class="popular-card-name">
        ${escapeHtml(img.name)}
        ${!img.name.includes('/') ? '<span class="official-badge">Official</span>' : ''}
      </div>
      <div class="popular-card-desc">${escapeHtml(img.description)}</div>
      <span class="popular-card-category">${escapeHtml(img.category)}</span>
    </div>`
    )
    .join('');

  els.popularGrid.querySelectorAll('.popular-card').forEach((card) => {
    card.addEventListener('click', () => selectImageForTransfer(card.dataset.image));
  });
}

async function searchDockerHubApi(query) {
  els.searchResultsBody.innerHTML = `
    <tr><td colspan="5" style="text-align:center;padding:2rem">
      <div class="spinner" style="margin:0 auto 0.5rem"></div>Searching…
    </td></tr>`;
  els.searchResults.classList.remove('hidden');

  try {
    const response = await fetch(`/api/dockerhub/search?query=${encodeURIComponent(query)}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    renderSearchResults(data.results || []);
    showToast(`Found ${data.count} results`);
  } catch (error) {
    els.searchResultsBody.innerHTML = `<tr><td colspan="5">Error: ${escapeHtml(error.message)}</td></tr>`;
  }
}

function renderSearchResults(results) {
  if (!results.length) {
    els.searchResultsBody.innerHTML = `<tr><td colspan="5">No images found</td></tr>`;
    return;
  }

  els.searchResultsBody.innerHTML = results
    .map(
      (r) => `
    <tr>
      <td><strong style="color:var(--foreground)">${escapeHtml(r.name)}</strong></td>
      <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${escapeHtml(r.description || '—')}
      </td>
      <td><span class="stars">★ ${formatStars(r.stars)}</span></td>
      <td>${r.isOfficial ? '<span class="official-mark">Official</span>' : '—'}</td>
      <td>
        <button class="btn btn-primary btn-sm select-transfer" data-image="${escapeHtml(r.name)}" type="button">Select</button>
      </td>
    </tr>`
    )
    .join('');

  els.searchResultsBody.querySelectorAll('.select-transfer').forEach((btn) => {
    btn.addEventListener('click', () => selectImageForTransfer(btn.dataset.image));
  });
}

async function fetchImageTags(imageName) {
  try {
    let namespace = '_';
    let repo = imageName;
    if (imageName.includes('/')) {
      const parts = imageName.split('/');
      namespace = parts[0];
      repo = parts[1];
    }
    const response = await fetch(`/api/dockerhub/tags/${namespace}/${repo}?pageSize=50`);
    const data = await response.json();
    return data.tags || [];
  } catch {
    return [];
  }
}

function populateRepoSelects() {
  const dockerRepos = repositories.filter((r) => r.format === 'DOCKER');
  const opts = dockerRepos
    .map((r) => `<option value="${r.location}|${r.name}">${r.name} (${r.location})</option>`)
    .join('');

  if (els.downloadRepoSelect) {
    els.downloadRepoSelect.innerHTML = `<option value="">Select a repository…</option>${opts}`;
  }
  if (els.transferRepoSelect) {
    els.transferRepoSelect.innerHTML = `<option value="">Select a Docker repository…</option>${opts}`;
  }
}

async function selectImageForTransfer(imageName) {
  selectedTransferImage = imageName;
  document.querySelector('.section')?.classList.add('hidden');
  document.querySelector('#uploadView .card:not(.transfer-section .card)')?.classList.add('hidden');
  // Hide popular + hub search card more reliably
  document.querySelectorAll('#uploadView > .section, #uploadView > .card').forEach((el) => {
    if (!el.closest('#transferSection') && el.id !== 'transferSection') {
      if (!el.classList.contains('transfer-section')) el.classList.add('hidden');
    }
  });
  // Simpler: hide first two children of upload view that aren't transfer
  const uploadView = $('uploadView');
  if (uploadView) {
    [...uploadView.children].forEach((child) => {
      if (child.id !== 'transferSection') child.classList.add('hidden');
    });
  }

  els.transferSection.classList.remove('hidden');
  els.transferSource.textContent = imageName;
  els.transferDest.textContent = 'Select repository…';
  els.transferTargetName.value = '';
  els.transferCommands.classList.add('hidden');

  els.transferTagSelect.innerHTML = '<option value="">Loading tags…</option>';
  const tags = await fetchImageTags(imageName);

  if (tags.length) {
    const common = ['latest', '22', '22.0', '21', '20', 'stable', 'alpine'];
    const sorted = tags.sort((a, b) => {
      const ai = common.indexOf(a.name);
      const bi = common.indexOf(b.name);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return 0;
    });
    els.transferTagSelect.innerHTML = sorted
      .slice(0, 50)
      .map(
        (t) =>
          `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)} (${escapeHtml(t.sizeFormatted)})</option>`
      )
      .join('');
  } else {
    els.transferTagSelect.innerHTML = '<option value="latest">latest</option>';
  }

  showToast(`Selected ${imageName}`);
}

function cancelTransferSelection() {
  selectedTransferImage = null;
  const uploadView = $('uploadView');
  if (uploadView) {
    [...uploadView.children].forEach((child) => {
      if (child.id !== 'transferSection') child.classList.remove('hidden');
    });
  }
  els.transferSection?.classList.add('hidden');
}

async function generateTransferCommands() {
  const repoValue = els.transferRepoSelect.value;
  const tag = els.transferTagSelect.value;
  const targetName = els.transferTargetName.value.trim();

  if (!repoValue) return showToast('Please select a target repository');
  if (!tag) return showToast('Please select a tag');

  const [location, repository] = repoValue.split('|');

  try {
    const response = await fetch('/api/transfer-commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceImage: selectedTransferImage,
        sourceTag: tag,
        targetRepo: repository,
        targetLocation: location,
        targetName: targetName || null,
        credentials,
      }),
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error);

    els.transferDest.textContent = data.summary.target;
    els.transferSteps.innerHTML = data.steps
      .map(
        (step) => `
      <div class="command-step">
        <span class="step-num">${step.step}</span>
        <div class="step-body">
          <p><strong>${escapeHtml(step.title)}</strong> — ${escapeHtml(step.description)}</p>
          <code class="code-block">${escapeHtml(step.command)}</code>
          <button class="btn btn-outline btn-sm" type="button" data-copy="${escapeHtml(step.command)}">Copy</button>
        </div>
      </div>`
      )
      .join('');

    els.transferSteps.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', () => copyToClipboard(btn.dataset.copy));
    });

    els.transferCommands.classList.remove('hidden');
    window.allTransferCommands = data.steps.map((s) => s.command).join('\n\n');
    showToast('Transfer commands generated');
  } catch (error) {
    showToast('Error: ' + error.message);
  }
}

// ─── Download ───────────────────────────────────────────────────────────────
async function loadDownloadImages({ reset = false } = {}) {
  if (!downloadState.location) return;

  if (reset) {
    downloadState.images = [];
    downloadState.nextPageToken = null;
    els.downloadImageSelect.innerHTML = '<option value="">Loading…</option>';
  }

  try {
    const data = await fetchDockerImagesPage({
      location: downloadState.location,
      name: downloadState.name,
      pageToken: reset ? null : downloadState.nextPageToken,
      range: 'all',
    });

    downloadState.images.push(...(data.images || []));
    downloadState.nextPageToken = data.nextPageToken || null;

    const grouped = groupDockerImages(downloadState.images);
    const options = [];
    grouped.forEach((group) => {
      const tags = group.allTags.length ? group.allTags : ['latest'];
      tags.slice(0, 8).forEach((tag) => {
        options.push({
          location: downloadState.location,
          repo: downloadState.name,
          imageName: group.name,
          tag,
          label: `${group.name}:${tag}`,
        });
      });
    });

    els.downloadImageSelect.innerHTML = `
      <option value="">Select an image…</option>
      ${options
        .map(
          (o) =>
            `<option value="${o.location}|${o.repo}|${o.imageName}|${o.tag}">${escapeHtml(o.label)}</option>`
        )
        .join('')}`;

    els.downloadLoadMore.hidden = !downloadState.nextPageToken;
  } catch {
    els.downloadImageSelect.innerHTML = '<option value="">Error loading images</option>';
    els.downloadLoadMore.hidden = true;
  }
}

// ─── Auth ───────────────────────────────────────────────────────────────────
async function validateAndConnect() {
  const inputValue = els.credentialsInput.value.trim();
  if (!inputValue) return showAuthError('Please paste your GCP credentials JSON');

  let creds;
  try {
    creds = JSON.parse(inputValue);
  } catch {
    return showAuthError('Invalid JSON format. Please check your credentials.');
  }

  if (!creds.project_id || !creds.private_key || !creds.client_email) {
    return showAuthError('Missing required fields: project_id, private_key, or client_email');
  }

  els.validateCredentials.disabled = true;
  els.validateCredentials.textContent = 'Validating…';
  hideAuthError();

  try {
    const response = await fetch('/api/validate-credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentials: creds }),
    });
    const data = await response.json();

    if (data.valid) {
      storeCredentials(creds);
      showMainApp();
      if (!location.hash || location.hash === '#') location.hash = '#/repositories';
      else await handleRoute();
      showToast('Connected successfully');
    } else {
      showAuthError(data.error || 'Failed to validate credentials');
    }
  } catch (e) {
    showAuthError('Connection failed: ' + e.message);
  } finally {
    els.validateCredentials.disabled = false;
    els.validateCredentials.textContent = 'Validate & connect';
  }
}

function showAuthError(message) {
  els.authError.textContent = message;
  els.authError.classList.remove('hidden');
}

function hideAuthError() {
  els.authError.classList.add('hidden');
}

function logout() {
  clearStoredCredentials();
  repositories = [];
  closeModal();
  closeCmdPalette();
  showAuthScreen();
  els.credentialsInput.value = '';
  showToast('Disconnected');
}

function copyToClipboard(text) {
  const report = (ok) => showToast(ok ? 'Copied to clipboard' : 'Failed to copy');
  // navigator.clipboard is unavailable on non-secure origins (plain-HTTP VM deployments)
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => report(true),
      () => report(legacyCopy(text))
    );
    return;
  }
  report(legacyCopy(text));
}

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

// ─── Events ─────────────────────────────────────────────────────────────────
function initEventListeners() {
  els.validateCredentials.addEventListener('click', validateAndConnect);
  els.credentialsInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) validateAndConnect();
  });

  els.logoutBtn?.addEventListener('click', logout);
  els.clearCredentials?.addEventListener('click', logout);

  window.addEventListener('hashchange', handleRoute);

  els.refreshBtn.addEventListener('click', async () => {
    const route = parseHash();
    if (route.name === 'repo') {
      repoDetail.images = [];
      repoDetail.packages = [];
      repoDetail.nextPageToken = null;
      repoDetail.reachedEnd = false;
      await loadRepoArtifacts({ reset: true });
    } else {
      await fetchRepositories();
    }
  });

  // Repo search
  els.repoSearch?.addEventListener('input', (e) => {
    repoSearchQuery = e.target.value;
    repoPage = 1;
    syncSearchClear('repoSearch');
    renderRepoList();
  });

  // Clear buttons
  document.querySelectorAll('[data-clear]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.clear;
      const input = $(id);
      if (!input) return;
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    });
  });

  // Time filters (segmented)
  els.timeFilters?.addEventListener('click', async (e) => {
    const chip = e.target.closest('.seg');
    if (!chip) return;
    const range = chip.dataset.range;
    if (range === repoDetail.range) return;
    repoDetail.range = range;
    els.timeFilters.querySelectorAll('.seg').forEach((c) => c.classList.toggle('active', c === chip));
    repoDetail.images = [];
    repoDetail.nextPageToken = null;
    repoDetail.reachedEnd = false;
    await loadRepoArtifacts({ reset: true });
  });

  els.imageSearch?.addEventListener('input', (e) => {
    repoDetail.search = e.target.value;
    syncSearchClear('imageSearch');
    renderTimeline();
  });

  els.loadMoreBtn?.addEventListener('click', () => loadRepoArtifacts({ reset: false }));

  // Full-screen modal
  els.modalClose?.addEventListener('click', closeModal);
  els.modalScrim?.addEventListener('click', closeModal);
  // Keep Tab inside the dialog while aria-modal is advertised
  els.imageModal?.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusables = [...els.imageModal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled && el.getBoundingClientRect().width > 0);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // Command palette
  els.cmdOpenBtn?.addEventListener('click', openCmdPalette);
  els.cmdScrim?.addEventListener('click', closeCmdPalette);
  els.cmdInput?.addEventListener('input', (e) => {
    cmdActive = 0;
    renderCmdResults(e.target.value);
  });
  els.cmdInput?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cmdActive = Math.min(cmdActive + 1, cmdItems.length - 1);
      renderCmdResults(els.cmdInput.value);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cmdActive = Math.max(cmdActive - 1, 0);
      renderCmdResults(els.cmdInput.value);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runCmdItem(cmdItems[cmdActive]);
    } else if (e.key === 'Escape') {
      closeCmdPalette();
    }
  });

  // Global keyboard
  document.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey;
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

    if (meta && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (els.cmdPalette.classList.contains('hidden')) openCmdPalette();
      else closeCmdPalette();
      return;
    }

    if (e.key === 'Escape') {
      if (!els.cmdPalette.classList.contains('hidden')) {
        closeCmdPalette();
        return;
      }
      closeModal();
      return;
    }

    // Focus image filter with /
    if (!typing && e.key === '/' && parseHash().name === 'repo') {
      e.preventDefault();
      els.imageSearch?.focus();
    }
  });

  // Upload
  els.searchDockerHub?.addEventListener('click', () => {
    const q = els.dockerHubSearch.value.trim();
    if (q) searchDockerHubApi(q);
    else showToast('Please enter a search term');
  });
  els.dockerHubSearch?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const q = els.dockerHubSearch.value.trim();
      if (q) searchDockerHubApi(q);
    }
  });
  els.cancelTransfer?.addEventListener('click', cancelTransferSelection);
  els.generateTransferCmd?.addEventListener('click', generateTransferCommands);
  els.copyAllCommands?.addEventListener('click', () => {
    if (window.allTransferCommands) copyToClipboard(window.allTransferCommands);
  });

  // Download
  els.downloadRepoSelect?.addEventListener('change', async (e) => {
    const value = e.target.value;
    els.pullCommands.classList.add('hidden');
    if (!value) {
      els.downloadImageSelect.innerHTML = '<option value="">Select a repository first…</option>';
      els.downloadLoadMore.hidden = true;
      return;
    }
    const [location, name] = value.split('|');
    downloadState.location = location;
    downloadState.name = name;
    await loadDownloadImages({ reset: true });
  });

  els.downloadLoadMore?.addEventListener('click', () => loadDownloadImages({ reset: false }));

  els.downloadImageSelect?.addEventListener('change', (e) => {
    const value = e.target.value;
    if (!value) {
      els.pullCommands.classList.add('hidden');
      return;
    }
    const [location, repo, imageName, tag] = value.split('|');
    const registryHost = `${location}-docker.pkg.dev`;
    const projectId = credentials?.project_id || 'PROJECT_ID';
    els.pullAuthCmd.textContent = `gcloud auth configure-docker ${registryHost} --quiet`;
    els.pullImageCmd.textContent = `docker pull ${registryHost}/${projectId}/${repo}/${imageName}:${tag || 'latest'}`;
    els.pullCommands.classList.remove('hidden');
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.copy-btn[data-target]');
    if (!btn) return;
    const target = $(btn.dataset.target);
    if (target) copyToClipboard(target.textContent);
  });
}

// ─── Init ───────────────────────────────────────────────────────────────────
async function init() {
  credentials = getStoredCredentials();
  initEventListeners();

  if (credentials) {
    showMainApp();
    if (!location.hash || location.hash === '#') location.hash = '#/repositories';
    else await handleRoute();
  } else {
    showAuthScreen();
  }
}

init();
