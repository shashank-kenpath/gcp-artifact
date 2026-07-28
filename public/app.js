// ─── Storage & state ────────────────────────────────────────────────────────
const STORAGE_KEY = 'gcp_artifact_credentials';
const REPO_PAGE_SIZE = 12;
const IMAGE_PAGE_SIZE = 20;

let credentials = null;
let repositories = [];
let selectedTransferImage = null;

// Repo list pagination (client-side over lightweight list)
let repoSearchQuery = '';
let repoPage = 1;

// Repo detail page state
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

// Download view pagination
const downloadState = {
  location: null,
  name: null,
  images: [],
  nextPageToken: null,
};

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
  drawer: $('drawer'),
  drawerTitle: $('drawerTitle'),
  drawerSubtitle: $('drawerSubtitle'),
  drawerBody: $('drawerBody'),
  drawerClose: $('drawerClose'),
  drawerBackdrop: $('drawerBackdrop'),
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
    const uploadDate = image.uploadedAt ? new Date(image.uploadedAt) : null;
    if (
      uploadDate &&
      (!groups[baseName].latestUpload || uploadDate > new Date(groups[baseName].latestUpload))
    ) {
      groups[baseName].latestUpload = image.uploadedAt;
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

function generatePullCommand(location, repository, imageName, tag) {
  const projectId = credentials?.project_id || 'PROJECT_ID';
  const tagSuffix = tag ? `:${tag}` : ':latest';
  return `docker pull ${location}-docker.pkg.dev/${projectId}/${repository}/${imageName}${tagSuffix}`;
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
    // Fallback from cached list
    return repositories.find((r) => r.location === location && r.name === name) || {
      name,
      location,
      format: 'DOCKER',
      description: '',
    };
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

  if (!parts.length || parts[0] === 'repositories') {
    return { name: 'repositories' };
  }
  if (parts[0] === 'repo' && parts[1] && parts[2]) {
    return {
      name: 'repo',
      location: decodeURIComponent(parts[1]),
      repo: decodeURIComponent(parts[2]),
    };
  }
  if (['upload', 'download', 'settings'].includes(parts[0])) {
    return { name: parts[0] };
  }
  return { name: 'repositories' };
}

function navigate(path) {
  if (!path.startsWith('#/')) path = '#/' + path.replace(/^\//, '');
  if (location.hash === path) {
    handleRoute();
  } else {
    location.hash = path;
  }
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
      subtitle: `${route.location}`,
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
    els.repoList.innerHTML = `<div class="empty-state"><p>No repositories found</p></div>`;
    els.repoPagination.innerHTML = '';
    return;
  }

  els.repoList.innerHTML = pageItems
    .map(
      (repo) => `
    <a class="repo-card" href="#/repo/${encodeURIComponent(repo.location)}/${encodeURIComponent(repo.name)}">
      <div class="repo-card-main">
        <div class="repo-card-icon ${getFormatBadgeClass(repo.format)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
            ${repo.sizeFormatted && repo.sizeFormatted !== 'N/A' ? `<span class="dot">·</span><span>${escapeHtml(repo.sizeFormatted)}</span>` : ''}
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
      <button class="btn btn-secondary btn-small page-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Previous</button>
      <span class="page-indicator">Page ${page} / ${totalPages}</span>
      <button class="btn btn-secondary btn-small page-btn" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>Next</button>
    </div>`;

  container.querySelectorAll('.page-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.page, 10);
      if (p >= 1 && p <= totalPages) onPage(p);
    });
  });
}

// ─── Repo detail page ───────────────────────────────────────────────────────
async function openRepoPage(location, name) {
  const isSame = repoDetail.location === location && repoDetail.name === name;
  repoDetail.location = location;
  repoDetail.name = name;

  // Reset content state when navigating to a (possibly new) repo
  if (!isSame) {
    repoDetail.images = [];
    repoDetail.packages = [];
    repoDetail.nextPageToken = null;
    repoDetail.reachedEnd = false;
    repoDetail.search = '';
    if (els.imageSearch) els.imageSearch.value = '';
  }

  // Highlight active time chip
  els.timeFilters.querySelectorAll('.chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.range === repoDetail.range);
  });

  els.repoDetailHeader.innerHTML = `
    <div class="repo-detail-skeleton">
      <div class="skeleton-line w-40"></div>
      <div class="skeleton-line w-60"></div>
    </div>`;
  els.timelineContainer.innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <span>Loading artifacts…</span>
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

  // Fresh load for this range
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
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <span>Fetching newest artifacts…</span>
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
      // Deduplicate by id
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
    // Attach uploadedAt for time bucketing
    const asItems = groups.map((g) => ({
      ...g,
      uploadedAt: g.latestUpload,
      _type: 'image',
    }));
    return groupByTimeBucket(asItems, 'uploadedAt');
  }

  let pkgs = repoDetail.packages;
  if (q) {
    pkgs = pkgs.filter((p) => p.name.toLowerCase().includes(q));
  }
  const asItems = pkgs.map((p) => ({ ...p, uploadedAt: p.updatedAt || p.createdAt, _type: 'package' }));
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
    from <strong>${totalLoaded}</strong> loaded artifact${totalLoaded === 1 ? '' : 's'}
    · range: <strong>${rangeLabel}</strong>
    ${repoDetail.reachedEnd ? '' : ' · more available'}</span>`;

  if (!buckets.length) {
    els.timelineContainer.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
        </svg>
        <p>No artifacts in this time range</p>
        <p class="muted-hint">Try a wider range or load more if available.</p>
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
              return `
              <article class="artifact-row" data-image="${escapeHtml(group.name)}">
                <div class="artifact-main" role="button" tabindex="0">
                  <div class="artifact-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
                      <span>${group.variants.length} variant${group.variants.length === 1 ? '' : 's'}</span>
                      <span class="dot">·</span>
                      <span>${escapeHtml(formatSize(group.totalSize))}</span>
                      <span class="dot">·</span>
                      <span>${tags.length} tag${tags.length === 1 ? '' : 's'}</span>
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
      const open = () => openImageDrawer(row.dataset.image);
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
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                  </svg>
                </div>
                <div class="artifact-body">
                  <div class="artifact-title-row">
                    <h4>${escapeHtml(pkg.name)}</h4>
                    <span class="relative-time" title="${escapeHtml(formatDate(pkg.updatedAt))}">
                      ${escapeHtml(relativeDate(pkg.updatedAt || pkg.createdAt))}
                    </span>
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

function openImageDrawer(imageName) {
  const groups = groupDockerImages(repoDetail.images);
  const group = groups.find((g) => g.name === imageName);
  if (!group) return;

  const location = repoDetail.location;
  const repository = repoDetail.name;
  const tags = group.allTags.length ? group.allTags : ['latest'];
  // Sort tags: latest first, then semantic-ish, then alpha
  const sortedTags = [...tags].sort((a, b) => {
    if (a === 'latest') return -1;
    if (b === 'latest') return 1;
    return a.localeCompare(b, undefined, { numeric: true });
  });

  // Paginate tags in the drawer (client-side over already-loaded variants)
  const TAG_PAGE = 20;
  let tagPage = 0;

  const authCmd = `gcloud auth configure-docker ${location}-docker.pkg.dev --quiet`;

  els.drawerTitle.textContent = imageName;
  els.drawerSubtitle.textContent = `${repository} · ${location}`;

  function renderDrawerTags() {
    const slice = sortedTags.slice(0, (tagPage + 1) * TAG_PAGE);
    const hasMore = slice.length < sortedTags.length;
    const tagsEl = els.drawerBody.querySelector('#drawerTags');
    if (!tagsEl) return;
    tagsEl.innerHTML = `
      <div class="drawer-tags-list">
        ${slice
          .map((tag) => {
            const pull = generatePullCommand(location, repository, imageName, tag);
            return `
            <div class="drawer-tag-row">
              <div class="drawer-tag-info">
                <code class="tag-name">${escapeHtml(tag)}</code>
              </div>
              <div class="drawer-tag-actions">
                <button class="btn btn-secondary btn-small copy-pull" data-cmd="${escapeHtml(pull)}" type="button">Copy pull</button>
              </div>
            </div>`;
          })
          .join('')}
      </div>
      ${
        hasMore
          ? `<button class="btn btn-secondary btn-small" id="moreTagsBtn" type="button" style="margin-top:12px;">
              Show more tags (${sortedTags.length - slice.length} left)
            </button>`
          : ''
      }`;

    tagsEl.querySelectorAll('.copy-pull').forEach((btn) => {
      btn.addEventListener('click', () => copyToClipboard(btn.dataset.cmd));
    });
    const more = tagsEl.querySelector('#moreTagsBtn');
    if (more) {
      more.addEventListener('click', () => {
        tagPage += 1;
        renderDrawerTags();
      });
    }
  }

  // Variants sorted by upload time, paginated
  const variants = [...group.variants].sort((a, b) => {
    return new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0);
  });
  const VAR_PAGE = 10;
  let varPage = 0;

  function renderVariants() {
    const slice = variants.slice(0, (varPage + 1) * VAR_PAGE);
    const hasMore = slice.length < variants.length;
    const el = els.drawerBody.querySelector('#drawerVariants');
    if (!el) return;
    el.innerHTML = `
      <div class="variants-list">
        ${slice
          .map(
            (v) => `
          <div class="variant-item">
            <div class="variant-info">
              <span class="variant-tags">${escapeHtml((v.tags || []).join(', ') || 'untagged')}</span>
              <span class="variant-meta">${escapeHtml(v.sizeFormatted)} · ${escapeHtml(relativeDate(v.uploadedAt))}</span>
            </div>
          </div>`
          )
          .join('')}
      </div>
      ${
        hasMore
          ? `<button class="btn btn-secondary btn-small" id="moreVarsBtn" type="button" style="margin-top:12px;">
              Show more variants
            </button>`
          : ''
      }`;
    const more = el.querySelector('#moreVarsBtn');
    if (more) {
      more.addEventListener('click', () => {
        varPage += 1;
        renderVariants();
      });
    }
  }

  const defaultPull = generatePullCommand(location, repository, imageName, sortedTags[0]);

  els.drawerBody.innerHTML = `
    <div class="drawer-section">
      <h4>Pull</h4>
      <div class="command-block compact">
        <div class="command-step">
          <span class="step-number">1</span>
          <div class="step-content">
            <p>Authenticate</p>
            <code>${escapeHtml(authCmd)}</code>
            <button class="copy-btn" type="button" data-copy="${escapeHtml(authCmd)}">Copy</button>
          </div>
        </div>
        <div class="command-step">
          <span class="step-number">2</span>
          <div class="step-content">
            <p>Pull (default tag: ${escapeHtml(sortedTags[0])})</p>
            <code>${escapeHtml(defaultPull)}</code>
            <button class="copy-btn" type="button" data-copy="${escapeHtml(defaultPull)}">Copy</button>
          </div>
        </div>
      </div>
    </div>

    <div class="drawer-section">
      <div class="section-head">
        <h4>Tags</h4>
        <span class="muted-hint">${sortedTags.length} total</span>
      </div>
      <div id="drawerTags"></div>
    </div>

    <div class="drawer-section">
      <div class="section-head">
        <h4>Variants by time</h4>
        <span class="muted-hint">${variants.length} loaded</span>
      </div>
      <div id="drawerVariants"></div>
    </div>
  `;

  els.drawerBody.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => copyToClipboard(btn.dataset.copy));
  });

  renderDrawerTags();
  renderVariants();
  openDrawer();
}

function openDrawer() {
  els.drawer.classList.remove('hidden');
  els.drawer.setAttribute('aria-hidden', 'false');
  document.body.classList.add('drawer-open');
}

function closeDrawer() {
  els.drawer.classList.add('hidden');
  els.drawer.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('drawer-open');
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
    <tr class="loading-row"><td colspan="5">
      <div class="loading-spinner"></div><span>Searching Docker Hub…</span>
    </td></tr>`;
  els.searchResults.classList.remove('hidden');

  try {
    const response = await fetch(`/api/dockerhub/search?query=${encodeURIComponent(query)}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    renderSearchResults(data.results || []);
    showToast(`Found ${data.count} results`);
  } catch (error) {
    els.searchResultsBody.innerHTML = `<tr class="empty-row"><td colspan="5">Error: ${escapeHtml(error.message)}</td></tr>`;
  }
}

function renderSearchResults(results) {
  if (!results.length) {
    els.searchResultsBody.innerHTML = `<tr class="empty-row"><td colspan="5">No images found</td></tr>`;
    return;
  }

  els.searchResultsBody.innerHTML = results
    .map(
      (r) => `
    <tr>
      <td><strong style="color: var(--text-primary)">${escapeHtml(r.name)}</strong></td>
      <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${escapeHtml(r.description || '-')}
      </td>
      <td><span class="stars">⭐ ${formatStars(r.stars)}</span></td>
      <td>${r.isOfficial ? '<span class="official-mark">Official</span>' : '-'}</td>
      <td>
        <button class="btn btn-primary btn-small select-transfer" data-image="${escapeHtml(r.name)}" type="button">Select</button>
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
    els.downloadRepoSelect.innerHTML = `<option value="">-- Select a repository --</option>${opts}`;
  }
  if (els.transferRepoSelect) {
    els.transferRepoSelect.innerHTML = `<option value="">-- Select a Docker repository --</option>${opts}`;
  }
}

async function selectImageForTransfer(imageName) {
  selectedTransferImage = imageName;
  document.querySelector('.popular-images-section')?.classList.add('hidden');
  document.querySelector('.search-section')?.classList.add('hidden');
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
      .map((t) => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)} (${escapeHtml(t.sizeFormatted)})</option>`)
      .join('');
  } else {
    els.transferTagSelect.innerHTML = '<option value="latest">latest</option>';
  }

  showToast(`Selected ${imageName}`);
}

function cancelTransferSelection() {
  selectedTransferImage = null;
  document.querySelector('.popular-images-section')?.classList.remove('hidden');
  document.querySelector('.search-section')?.classList.remove('hidden');
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
        <span class="step-number">${step.step}</span>
        <div class="step-content">
          <p><strong>${escapeHtml(step.title)}</strong></p>
          <p>${escapeHtml(step.description)}</p>
          <code>${escapeHtml(step.command)}</code>
          <button class="copy-btn" type="button" data-copy="${escapeHtml(step.command)}">Copy</button>
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

// ─── Download (paginated) ───────────────────────────────────────────────────
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

    const incoming = data.images || [];
    downloadState.images.push(...incoming);
    downloadState.nextPageToken = data.nextPageToken || null;

    const grouped = groupDockerImages(downloadState.images);
    const options = [];
    grouped.forEach((group) => {
      const tags = group.allTags.length ? group.allTags : ['latest'];
      // Only first few tags per image to keep select usable
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
      <option value="">-- Select an image --</option>
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
  els.validateCredentials.innerHTML =
    '<div class="loading-spinner" style="width:20px;height:20px;margin-right:8px;"></div> Validating…';
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
      if (!location.hash || location.hash === '#') {
        // hashchange will run handleRoute once
        location.hash = '#/repositories';
      } else {
        await handleRoute();
      }
      showToast('Connected successfully');
    } else {
      showAuthError(data.error || 'Failed to validate credentials');
    }
  } catch (e) {
    showAuthError('Connection failed: ' + e.message);
  } finally {
    els.validateCredentials.disabled = false;
    els.validateCredentials.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
      Validate &amp; Connect`;
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
  showAuthScreen();
  els.credentialsInput.value = '';
  showToast('Disconnected');
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(
    () => showToast('Copied to clipboard'),
    () => showToast('Failed to copy')
  );
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

  els.repoSearch?.addEventListener('input', (e) => {
    repoSearchQuery = e.target.value;
    repoPage = 1;
    renderRepoList();
  });

  // Time filters
  els.timeFilters?.addEventListener('click', async (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const range = chip.dataset.range;
    if (range === repoDetail.range) return;
    repoDetail.range = range;
    els.timeFilters.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
    repoDetail.images = [];
    repoDetail.nextPageToken = null;
    repoDetail.reachedEnd = false;
    await loadRepoArtifacts({ reset: true });
  });

  els.imageSearch?.addEventListener('input', (e) => {
    repoDetail.search = e.target.value;
    renderTimeline();
  });

  els.loadMoreBtn?.addEventListener('click', () => loadRepoArtifacts({ reset: false }));

  // Drawer
  els.drawerClose?.addEventListener('click', closeDrawer);
  els.drawerBackdrop?.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
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
      els.downloadImageSelect.innerHTML = '<option value="">-- Select a repository first --</option>';
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

  // Copy buttons with data-target
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
    if (!location.hash || location.hash === '#') {
      location.hash = '#/repositories';
    } else {
      await handleRoute();
    }
  } else {
    showAuthScreen();
  }
}

init();
