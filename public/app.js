// LocalStorage key for credentials
const STORAGE_KEY = 'gcp_artifact_credentials';

// State
let repositories = [];
let currentRepo = null;
let selectedTransferImage = null;
let credentials = null;

// Get credentials from localStorage
function getStoredCredentials() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to parse stored credentials:', e);
  }
  return null;
}

// Store credentials in localStorage
function storeCredentials(creds) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
    credentials = creds;
  } catch (e) {
    console.error('Failed to store credentials:', e);
  }
}

// Clear credentials from localStorage
function clearCredentials() {
  localStorage.removeItem(STORAGE_KEY);
  credentials = null;
}

// DOM Elements
const elements = {
  // Auth Screen
  authScreen: document.getElementById('authScreen'),
  mainApp: document.getElementById('mainApp'),
  credentialsInput: document.getElementById('credentialsInput'),
  validateCredentials: document.getElementById('validateCredentials'),
  authError: document.getElementById('authError'),

  // Main App
  projectId: document.getElementById('projectId'),
  pageTitle: document.getElementById('pageTitle'),
  pageSubtitle: document.getElementById('pageSubtitle'),
  refreshBtn: document.getElementById('refreshBtn'),
  logoutBtn: document.getElementById('logoutBtn'),

  // Stats
  totalRepos: document.getElementById('totalRepos'),
  dockerRepos: document.getElementById('dockerRepos'),
  otherRepos: document.getElementById('otherRepos'),

  // Navigation
  navItems: document.querySelectorAll('.nav-item'),
  views: document.querySelectorAll('.view'),

  // Tables
  repoTableBody: document.getElementById('repoTableBody'),
  dockerTableBody: document.getElementById('dockerTableBody'),
  repoSearch: document.getElementById('repoSearch'),
  dockerSearch: document.getElementById('dockerSearch'),

  // Selects
  dockerRepoSelect: document.getElementById('dockerRepoSelect'),
  downloadRepoSelect: document.getElementById('downloadRepoSelect'),
  downloadImageSelect: document.getElementById('downloadImageSelect'),

  // Download
  pullCommands: document.getElementById('pullCommands'),
  pullAuthCmd: document.getElementById('pullAuthCmd'),
  pullImageCmd: document.getElementById('pullImageCmd'),

  // Docker Hub Browser
  popularGrid: document.getElementById('popularGrid'),
  dockerHubSearch: document.getElementById('dockerHubSearch'),
  searchDockerHub: document.getElementById('searchDockerHub'),
  searchResults: document.getElementById('searchResults'),
  searchResultsBody: document.getElementById('searchResultsBody'),

  // Transfer Section
  transferSection: document.getElementById('transferSection'),
  cancelTransfer: document.getElementById('cancelTransfer'),
  transferSource: document.getElementById('transferSource'),
  transferDest: document.getElementById('transferDest'),
  transferRepoSelect: document.getElementById('transferRepoSelect'),
  transferTagSelect: document.getElementById('transferTagSelect'),
  transferTargetName: document.getElementById('transferTargetName'),
  generateTransferCmd: document.getElementById('generateTransferCmd'),
  transferCommands: document.getElementById('transferCommands'),
  transferSteps: document.getElementById('transferSteps'),
  copyAllCommands: document.getElementById('copyAllCommands'),

  // Settings
  settingsProjectId: document.getElementById('settingsProjectId'),
  settingsServiceAccount: document.getElementById('settingsServiceAccount'),
  clearCredentialsBtn: document.getElementById('clearCredentials'),

  // Modal
  modal: document.getElementById('modal'),
  modalTitle: document.getElementById('modalTitle'),
  modalBody: document.getElementById('modalBody'),
  modalClose: document.getElementById('modalClose'),

  // Toast
  toast: document.getElementById('toast'),
  toastMessage: document.getElementById('toastMessage'),
};

// Utility Functions
function showToast(message, duration = 3000) {
  elements.toastMessage.textContent = message;
  elements.toast.classList.remove('hidden');
  setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, duration);
}

function formatDate(isoString) {
  if (!isoString) return 'N/A';
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getFormatBadgeClass(format) {
  const formatLower = (format || '').toLowerCase();
  if (formatLower.includes('docker')) return 'docker';
  if (formatLower.includes('npm')) return 'npm';
  if (formatLower.includes('maven')) return 'maven';
  if (formatLower.includes('python') || formatLower.includes('pypi')) return 'python';
  return 'unknown';
}

function formatStars(stars) {
  if (stars >= 1000000) return (stars / 1000000).toFixed(1) + 'M';
  if (stars >= 1000) return (stars / 1000).toFixed(1) + 'K';
  return stars.toString();
}

// Show/hide auth screen vs main app
function showAuthScreen() {
  elements.authScreen.classList.remove('hidden');
  elements.mainApp.classList.add('hidden');
}

function showMainApp() {
  elements.authScreen.classList.add('hidden');
  elements.mainApp.classList.remove('hidden');

  // Update displays
  if (credentials) {
    elements.projectId.textContent = credentials.project_id;
    if (elements.settingsProjectId) {
      elements.settingsProjectId.textContent = credentials.project_id;
    }
    if (elements.settingsServiceAccount) {
      elements.settingsServiceAccount.textContent = credentials.client_email;
    }
  }
}

// Validate and connect with credentials
async function validateAndConnect() {
  const inputValue = elements.credentialsInput.value.trim();

  if (!inputValue) {
    showAuthError('Please paste your GCP credentials JSON');
    return;
  }

  let creds;
  try {
    creds = JSON.parse(inputValue);
  } catch (e) {
    showAuthError('Invalid JSON format. Please check your credentials.');
    return;
  }

  if (!creds.project_id || !creds.private_key || !creds.client_email) {
    showAuthError('Missing required fields: project_id, private_key, or client_email');
    return;
  }

  // Show loading state
  elements.validateCredentials.disabled = true;
  elements.validateCredentials.innerHTML = '<div class="loading-spinner" style="width: 20px; height: 20px; margin-right: 8px;"></div> Validating...';
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
      await fetchRepositories();
      showToast('Connected successfully!');
    } else {
      showAuthError(data.error || 'Failed to validate credentials');
    }
  } catch (e) {
    showAuthError('Connection failed: ' + e.message);
  } finally {
    elements.validateCredentials.disabled = false;
    elements.validateCredentials.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
      Validate & Connect
    `;
  }
}

function showAuthError(message) {
  elements.authError.textContent = message;
  elements.authError.classList.remove('hidden');
}

function hideAuthError() {
  elements.authError.classList.add('hidden');
}

// Logout / disconnect
function logout() {
  clearCredentials();
  repositories = [];
  showAuthScreen();
  elements.credentialsInput.value = '';
  showToast('Disconnected');
}

// API Functions - all now send credentials via POST
async function fetchRepositories() {
  if (!credentials) return;

  elements.repoTableBody.innerHTML = `
    <tr class="loading-row">
      <td colspan="6">
        <div class="loading-spinner"></div>
        <span>Loading repositories...</span>
      </td>
    </tr>
  `;

  try {
    const response = await fetch('/api/repositories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentials }),
    });
    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    repositories = data.repositories;
    updateStats();
    renderRepositories(repositories);
    populateRepoSelects();

    showToast(`Loaded ${repositories.length} repositories`);
  } catch (error) {
    console.error('Failed to fetch repositories:', error);
    elements.repoTableBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="6">Error: ${error.message}</td>
      </tr>
    `;
  }
}

async function fetchDockerImages(location, repository) {
  if (!credentials) return;

  elements.dockerTableBody.innerHTML = `
    <tr class="loading-row">
      <td colspan="5">
        <div class="loading-spinner"></div>
        <span>Loading Docker images...</span>
      </td>
    </tr>
  `;

  try {
    const response = await fetch(`/api/repositories/${location}/${repository}/docker-images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentials }),
    });
    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    renderDockerImages(data.images);
    showToast(`Loaded ${data.images.length} Docker images`);
  } catch (error) {
    console.error('Failed to fetch Docker images:', error);
    elements.dockerTableBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="5">Error: ${error.message}</td>
      </tr>
    `;
  }
}

async function fetchPackages(location, repository) {
  if (!credentials) return [];

  try {
    const response = await fetch(`/api/repositories/${location}/${repository}/packages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentials }),
    });
    const data = await response.json();
    return data.packages || [];
  } catch (error) {
    console.error('Failed to fetch packages:', error);
    return [];
  }
}

async function fetchPopularImages() {
  try {
    const response = await fetch('/api/dockerhub/popular');
    const data = await response.json();
    renderPopularImages(data.images || []);
  } catch (error) {
    console.error('Failed to fetch popular images:', error);
  }
}

async function searchDockerHubApi(query) {
  elements.searchResultsBody.innerHTML = `
    <tr class="loading-row">
      <td colspan="5">
        <div class="loading-spinner"></div>
        <span>Searching Docker Hub...</span>
      </td>
    </tr>
  `;
  elements.searchResults.classList.remove('hidden');

  try {
    const response = await fetch(`/api/dockerhub/search?query=${encodeURIComponent(query)}`);
    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    renderSearchResults(data.results || []);
    showToast(`Found ${data.count} results`);
  } catch (error) {
    console.error('Docker Hub search error:', error);
    elements.searchResultsBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="5">Error: ${error.message}</td>
      </tr>
    `;
  }
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

    const response = await fetch(`/api/dockerhub/tags/${namespace}/${repo}`);
    const data = await response.json();
    return data.tags || [];
  } catch (error) {
    console.error('Failed to fetch tags:', error);
    return [];
  }
}

// Render Functions
function updateStats() {
  const docker = repositories.filter(r => r.format === 'DOCKER').length;
  const other = repositories.length - docker;

  elements.totalRepos.textContent = repositories.length;
  elements.dockerRepos.textContent = docker;
  elements.otherRepos.textContent = other;
}

function renderRepositories(repos) {
  if (repos.length === 0) {
    elements.repoTableBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="6">No repositories found</td>
      </tr>
    `;
    return;
  }

  elements.repoTableBody.innerHTML = repos.map(repo => `
    <tr>
      <td>
        <strong style="color: var(--text-primary)">${repo.name}</strong>
      </td>
      <td>
        <span class="format-badge ${getFormatBadgeClass(repo.format)}">${repo.format}</span>
      </td>
      <td>${repo.location}</td>
      <td>${repo.description || '-'}</td>
      <td>${formatDate(repo.createdAt)}</td>
      <td>
        <button class="action-btn" onclick="viewRepoDetails('${repo.location}', '${repo.name}', '${repo.format}')" title="View Details">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        </button>
        ${repo.format === 'DOCKER' ? `
          <button class="action-btn" onclick="showDockerImagesForRepo('${repo.location}', '${repo.name}')" title="View Docker Images">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
            </svg>
          </button>
        ` : ''}
      </td>
    </tr>
  `).join('');
}

function renderDockerImages(images) {
  if (images.length === 0) {
    elements.dockerTableBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="5">No Docker images found in this repository</td>
      </tr>
    `;
    return;
  }

  elements.dockerTableBody.innerHTML = images.map(image => `
    <tr>
      <td>
        <strong style="color: var(--text-primary)">${image.name}</strong>
      </td>
      <td>
        <div class="tag-list">
          ${image.tags.length > 0
      ? image.tags.slice(0, 3).map(tag => `<span class="tag">${tag}</span>`).join('')
      : '<span style="color: var(--text-muted)">untagged</span>'}
          ${image.tags.length > 3 ? `<span class="tag">+${image.tags.length - 3}</span>` : ''}
        </div>
      </td>
      <td>${image.sizeFormatted}</td>
      <td>${formatDate(image.uploadedAt)}</td>
      <td>
        <button class="action-btn" onclick="showPullCommand('${image.uri}', '${image.tags[0] || ''}')" title="Get Pull Command">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </button>
        <button class="action-btn" onclick="copyToClipboard('${image.uri}')" title="Copy URI">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
        </button>
      </td>
    </tr>
  `).join('');
}

function renderPopularImages(images) {
  if (!elements.popularGrid) return;

  elements.popularGrid.innerHTML = images.map(img => `
    <div class="popular-card" onclick="selectImageForTransfer('${img.name}')">
      <div class="popular-card-name">
        ${img.name}
        ${!img.name.includes('/') ? '<span class="official-badge">Official</span>' : ''}
      </div>
      <div class="popular-card-desc">${img.description}</div>
      <span class="popular-card-category">${img.category}</span>
    </div>
  `).join('');
}

function renderSearchResults(results) {
  if (results.length === 0) {
    elements.searchResultsBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="5">No images found</td>
      </tr>
    `;
    return;
  }

  elements.searchResultsBody.innerHTML = results.map(result => `
    <tr>
      <td>
        <strong style="color: var(--text-primary)">${result.name}</strong>
      </td>
      <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${result.description || '-'}
      </td>
      <td>
        <span class="stars">⭐ ${formatStars(result.stars)}</span>
      </td>
      <td>
        ${result.isOfficial ? '<span class="official-mark"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> Official</span>' : '-'}
      </td>
      <td>
        <button class="btn btn-primary" style="padding: 8px 16px; font-size: 0.8rem;" onclick="selectImageForTransfer('${result.name}')">
          Select
        </button>
      </td>
    </tr>
  `).join('');
}

function populateRepoSelects() {
  const dockerRepos = repositories.filter(r => r.format === 'DOCKER');

  const dockerOptions = dockerRepos.map(r =>
    `<option value="${r.location}|${r.name}">${r.name} (${r.location})</option>`
  ).join('');

  if (elements.dockerRepoSelect) {
    elements.dockerRepoSelect.innerHTML = `<option value="">-- Select a Docker repository --</option>${dockerOptions}`;
  }
  if (elements.downloadRepoSelect) {
    elements.downloadRepoSelect.innerHTML = `<option value="">-- Select a repository --</option>${dockerOptions}`;
  }
  if (elements.transferRepoSelect) {
    elements.transferRepoSelect.innerHTML = `<option value="">-- Select a Docker repository --</option>${dockerOptions}`;
  }
}

// Transfer Functions
async function selectImageForTransfer(imageName) {
  selectedTransferImage = imageName;

  document.querySelector('.popular-images-section').classList.add('hidden');
  document.querySelector('.search-section').classList.add('hidden');
  elements.transferSection.classList.remove('hidden');

  elements.transferSource.textContent = imageName;
  elements.transferDest.textContent = 'Select repository...';

  elements.transferTargetName.value = '';
  elements.transferCommands.classList.add('hidden');

  elements.transferTagSelect.innerHTML = '<option value="">Loading tags...</option>';
  const tags = await fetchImageTags(imageName);

  if (tags.length > 0) {
    const commonTags = ['latest', '22', '22.0', '21', '20', 'stable', 'alpine'];
    const sortedTags = tags.sort((a, b) => {
      const aIndex = commonTags.indexOf(a.name);
      const bIndex = commonTags.indexOf(b.name);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return 0;
    });

    elements.transferTagSelect.innerHTML = sortedTags.slice(0, 50).map(tag =>
      `<option value="${tag.name}">${tag.name} (${tag.sizeFormatted})</option>`
    ).join('');
  } else {
    elements.transferTagSelect.innerHTML = '<option value="latest">latest</option>';
  }

  showToast(`Selected ${imageName} for transfer`);
}

function cancelTransferSelection() {
  selectedTransferImage = null;

  document.querySelector('.popular-images-section').classList.remove('hidden');
  document.querySelector('.search-section').classList.remove('hidden');
  elements.transferSection.classList.add('hidden');
}

async function generateTransferCommands() {
  const repoValue = elements.transferRepoSelect.value;
  const tag = elements.transferTagSelect.value;
  const targetName = elements.transferTargetName.value.trim();

  if (!repoValue) {
    showToast('Please select a target repository');
    return;
  }

  if (!tag) {
    showToast('Please select a tag');
    return;
  }

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
        credentials: credentials,
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    elements.transferDest.textContent = data.summary.target;

    elements.transferSteps.innerHTML = data.steps.map(step => `
      <div class="command-step">
        <span class="step-number">${step.step}</span>
        <div class="step-content">
          <p><strong>${step.title}</strong></p>
          <p>${step.description}</p>
          <code>${step.command}</code>
          <button class="copy-btn" onclick="copyToClipboard(\`${step.command.replace(/`/g, '\\`')}\`)">Copy</button>
        </div>
      </div>
    `).join('');

    elements.transferCommands.classList.remove('hidden');

    window.allTransferCommands = data.steps.map(s => s.command).join('\n\n');

    showToast('Transfer commands generated!');
  } catch (error) {
    console.error('Failed to generate transfer commands:', error);
    showToast('Error: ' + error.message);
  }
}

// Action Functions
async function viewRepoDetails(location, repoName, format) {
  elements.modalTitle.textContent = `${repoName} Details`;
  elements.modalBody.innerHTML = '<div class="loading-spinner"></div><p>Loading packages...</p>';
  elements.modal.classList.remove('hidden');

  const packages = await fetchPackages(location, repoName);

  if (packages.length === 0) {
    elements.modalBody.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--text-muted);">
        <p>No packages found in this ${format} repository.</p>
        ${format === 'DOCKER' ? '<p>Use the Docker Images view to see container images.</p>' : ''}
      </div>
    `;
    return;
  }

  elements.modalBody.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Package Name</th>
          <th>Created</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        ${packages.map(pkg => `
          <tr>
            <td><strong style="color: var(--text-primary)">${pkg.name}</strong></td>
            <td>${formatDate(pkg.createdAt)}</td>
            <td>${formatDate(pkg.updatedAt)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function showDockerImagesForRepo(location, repoName) {
  switchView('docker');
  elements.dockerRepoSelect.value = `${location}|${repoName}`;
  fetchDockerImages(location, repoName);
}

async function showPullCommand(uri, tag) {
  elements.modalTitle.textContent = 'Pull Command';

  const registryHost = uri.split('/')[0];
  const authCmd = `gcloud auth configure-docker ${registryHost} --quiet`;

  let pullCmd = `docker pull ${uri}`;
  if (tag) {
    const baseUri = uri.split('@')[0];
    pullCmd = `docker pull ${baseUri}:${tag}`;
  }

  elements.modalBody.innerHTML = `
    <div class="command-output" style="margin-top: 0;">
      <div class="command-step">
        <span class="step-number">1</span>
        <div class="step-content">
          <p>Authenticate Docker with GCP:</p>
          <code>${authCmd}</code>
          <button class="copy-btn" onclick="copyToClipboard('${authCmd}')">Copy</button>
        </div>
      </div>
      <div class="command-step">
        <span class="step-number">2</span>
        <div class="step-content">
          <p>Pull the image:</p>
          <code>${pullCmd}</code>
          <button class="copy-btn" onclick="copyToClipboard('${pullCmd}')">Copy</button>
        </div>
      </div>
    </div>
  `;

  elements.modal.classList.remove('hidden');
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard!');
  }).catch(err => {
    console.error('Failed to copy:', err);
    showToast('Failed to copy');
  });
}

// View Switching
function switchView(viewName) {
  elements.navItems.forEach(item => {
    item.classList.toggle('active', item.dataset.view === viewName);
  });

  elements.views.forEach(view => {
    view.classList.toggle('active', view.id === `${viewName}View`);
  });

  const titles = {
    repositories: { title: 'Repositories', subtitle: 'View and manage your artifact repositories' },
    docker: { title: 'Docker Images', subtitle: 'Browse and pull Docker images from your registry' },
    upload: { title: 'Upload from Docker Hub', subtitle: 'Transfer public Docker images to your GCP Artifact Registry' },
    download: { title: 'Download', subtitle: 'Pull Docker images from your repository' },
    settings: { title: 'Settings', subtitle: 'Manage your credentials and preferences' },
  };

  const t = titles[viewName] || titles.repositories;
  elements.pageTitle.textContent = t.title;
  elements.pageSubtitle.textContent = t.subtitle;

  if (viewName === 'upload') {
    cancelTransferSelection();
    fetchPopularImages();
  }
}

// Event Listeners
function initEventListeners() {
  // Auth screen
  elements.validateCredentials.addEventListener('click', validateAndConnect);

  elements.credentialsInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      validateAndConnect();
    }
  });

  // Logout
  if (elements.logoutBtn) {
    elements.logoutBtn.addEventListener('click', logout);
  }

  if (elements.clearCredentialsBtn) {
    elements.clearCredentialsBtn.addEventListener('click', logout);
  }

  // Navigation
  elements.navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      switchView(item.dataset.view);
    });
  });

  // Refresh
  elements.refreshBtn.addEventListener('click', fetchRepositories);

  // Search repositories
  if (elements.repoSearch) {
    elements.repoSearch.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      const filtered = repositories.filter(r =>
        r.name.toLowerCase().includes(query) ||
        r.format.toLowerCase().includes(query) ||
        r.location.toLowerCase().includes(query)
      );
      renderRepositories(filtered);
    });
  }

  // Docker repo select
  if (elements.dockerRepoSelect) {
    elements.dockerRepoSelect.addEventListener('change', (e) => {
      const value = e.target.value;
      if (value) {
        const [location, name] = value.split('|');
        fetchDockerImages(location, name);
      }
    });
  }

  // Download repo select
  if (elements.downloadRepoSelect) {
    elements.downloadRepoSelect.addEventListener('change', async (e) => {
      const value = e.target.value;
      elements.pullCommands.classList.add('hidden');

      if (value) {
        const [location, name] = value.split('|');

        try {
          const response = await fetch(`/api/repositories/${location}/${name}/docker-images`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credentials }),
          });
          const data = await response.json();

          if (data.images && data.images.length > 0) {
            elements.downloadImageSelect.innerHTML = `
              <option value="">-- Select an image --</option>
              ${data.images.map(img => `
                <option value="${img.uri}|${img.tags[0] || ''}">${img.name} ${img.tags[0] ? `(${img.tags[0]})` : '(untagged)'}</option>
              `).join('')}
            `;
          } else {
            elements.downloadImageSelect.innerHTML = '<option value="">No images found</option>';
          }
        } catch (error) {
          elements.downloadImageSelect.innerHTML = '<option value="">Error loading images</option>';
        }
      } else {
        elements.downloadImageSelect.innerHTML = '<option value="">-- Select a repository first --</option>';
      }
    });
  }

  // Download image select
  if (elements.downloadImageSelect) {
    elements.downloadImageSelect.addEventListener('change', (e) => {
      const value = e.target.value;
      if (value) {
        const [uri, tag] = value.split('|');
        const registryHost = uri.split('/')[0];

        const authCmd = `gcloud auth configure-docker ${registryHost} --quiet`;
        let pullCmd = `docker pull ${uri}`;
        if (tag) {
          const baseUri = uri.split('@')[0];
          pullCmd = `docker pull ${baseUri}:${tag}`;
        }

        elements.pullAuthCmd.textContent = authCmd;
        elements.pullImageCmd.textContent = pullCmd;
        elements.pullCommands.classList.remove('hidden');
      } else {
        elements.pullCommands.classList.add('hidden');
      }
    });
  }

  // Docker Hub Search
  if (elements.searchDockerHub) {
    elements.searchDockerHub.addEventListener('click', () => {
      const query = elements.dockerHubSearch.value.trim();
      if (query) {
        searchDockerHubApi(query);
      } else {
        showToast('Please enter a search term');
      }
    });
  }

  if (elements.dockerHubSearch) {
    elements.dockerHubSearch.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const query = elements.dockerHubSearch.value.trim();
        if (query) {
          searchDockerHubApi(query);
        }
      }
    });
  }

  // Cancel transfer
  if (elements.cancelTransfer) {
    elements.cancelTransfer.addEventListener('click', cancelTransferSelection);
  }

  // Generate transfer commands
  if (elements.generateTransferCmd) {
    elements.generateTransferCmd.addEventListener('click', generateTransferCommands);
  }

  // Copy all commands
  if (elements.copyAllCommands) {
    elements.copyAllCommands.addEventListener('click', () => {
      if (window.allTransferCommands) {
        copyToClipboard(window.allTransferCommands);
      }
    });
  }

  // Modal close
  elements.modalClose.addEventListener('click', () => {
    elements.modal.classList.add('hidden');
  });

  document.querySelector('.modal-backdrop').addEventListener('click', () => {
    elements.modal.classList.add('hidden');
  });

  // Escape key to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      elements.modal.classList.add('hidden');
    }
  });
}

// Initialize
async function init() {
  // Check if we have stored credentials
  credentials = getStoredCredentials();

  if (credentials) {
    // Already have credentials, show main app
    showMainApp();
    await fetchRepositories();
  } else {
    // No credentials, show auth screen
    showAuthScreen();
  }

  initEventListeners();
}

// Make functions global for onclick handlers
window.viewRepoDetails = viewRepoDetails;
window.showDockerImagesForRepo = showDockerImagesForRepo;
window.showPullCommand = showPullCommand;
window.copyToClipboard = copyToClipboard;
window.selectImageForTransfer = selectImageForTransfer;

// Start the app
init();
