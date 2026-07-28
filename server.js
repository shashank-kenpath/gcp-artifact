import express from 'express';
import cors from 'cors';
import { ArtifactRegistryClient } from '@google-cloud/artifact-registry';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const DEFAULT_LOCATIONS = [
  'asia-south1',
  'us-central1',
  'us-east1',
  'europe-west1',
  'asia-southeast1',
];

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Utility functions
function formatDate(timestamp) {
  if (!timestamp) return null;
  const ms =
    typeof timestamp.seconds === 'string' || typeof timestamp.seconds === 'number'
      ? Number(timestamp.seconds) * 1000
      : timestamp instanceof Date
        ? timestamp.getTime()
        : null;
  if (ms == null || Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function formatSize(bytes) {
  if (!bytes) return 'N/A';
  const n = Number(bytes);
  if (!n) return '0 Bytes';
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), sizes.length - 1);
  return `${(n / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

function parsePageSize(value, fallback = 25, max = 100) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n < 1) return fallback;
  return Math.min(n, max);
}

function createClient(credentials) {
  return new ArtifactRegistryClient({
    credentials: {
      client_email: credentials.client_email,
      private_key: credentials.private_key,
    },
    projectId: credentials.project_id,
  });
}

function withCredentials(req, res, next) {
  const credentials = req.body.credentials || req.query.credentials;

  if (!credentials) {
    return res.status(401).json({
      error: 'No credentials provided',
      requiresAuth: true,
    });
  }

  try {
    const creds = typeof credentials === 'string' ? JSON.parse(credentials) : credentials;

    if (!creds.project_id || !creds.private_key || !creds.client_email) {
      return res.status(400).json({
        error: 'Invalid credentials format. Required: project_id, private_key, client_email',
        requiresAuth: true,
      });
    }

    req.gcpCredentials = creds;
    req.gcpClient = createClient(creds);
    next();
  } catch (e) {
    return res.status(400).json({
      error: 'Failed to parse credentials: ' + e.message,
      requiresAuth: true,
    });
  }
}

function formatRepository(repo) {
  const nameParts = repo.name.split('/');
  return {
    id: repo.name,
    name: nameParts[nameParts.length - 1],
    location: nameParts[3],
    format: repo.format || 'UNKNOWN',
    description: repo.description || '',
    createdAt: formatDate(repo.createTime),
    updatedAt: formatDate(repo.updateTime),
    sizeBytes: repo.sizeBytes ? Number(repo.sizeBytes) : 0,
    sizeFormatted: formatSize(repo.sizeBytes ? Number(repo.sizeBytes) : 0),
  };
}

function formatPackage(pkg) {
  const nameParts = pkg.name.split('/');
  return {
    id: pkg.name,
    name: nameParts[nameParts.length - 1],
    displayName: pkg.displayName || nameParts[nameParts.length - 1],
    createdAt: formatDate(pkg.createTime),
    updatedAt: formatDate(pkg.updateTime),
  };
}

function formatVersion(version) {
  const nameParts = version.name.split('/');
  return {
    id: version.name,
    name: nameParts[nameParts.length - 1],
    description: version.description || '',
    createdAt: formatDate(version.createTime),
    updatedAt: formatDate(version.updateTime),
    metadata: version.metadata || {},
  };
}

function formatDockerImage(image) {
  const nameParts = image.name.split('/');
  return {
    id: image.name,
    name: nameParts.slice(-2).join('/'),
    uri: image.uri,
    tags: image.tags || [],
    sizeBytes: image.imageSizeBytes ? Number(image.imageSizeBytes) : 0,
    sizeFormatted: formatSize(image.imageSizeBytes ? Number(image.imageSizeBytes) : 0),
    uploadedAt: formatDate(image.uploadTime),
    buildTime: formatDate(image.buildTime),
    mediaType: image.mediaType || '',
  };
}

/** List one page without auto-pagination. Returns { items, nextPageToken }. */
async function listPage(client, method, request) {
  try {
    const [items, , response] = await client[method](request, { autoPaginate: false });
    return {
      items: items || [],
      nextPageToken: response?.nextPageToken || null,
    };
  } catch (err) {
    // Some orderBy values are rejected — retry without orderBy
    if (request.orderBy && (err.code === 3 || /order/i.test(err.message || ''))) {
      const { orderBy: _drop, ...rest } = request;
      const [items, , response] = await client[method](rest, { autoPaginate: false });
      return {
        items: items || [],
        nextPageToken: response?.nextPageToken || null,
        orderByFallback: true,
      };
    }
    throw err;
  }
}

// ─── Auth ───────────────────────────────────────────────────────────────────

app.post('/api/validate-credentials', async (req, res) => {
  const { credentials } = req.body;

  if (!credentials) {
    return res.status(400).json({ valid: false, error: 'No credentials provided' });
  }

  try {
    const creds = typeof credentials === 'string' ? JSON.parse(credentials) : credentials;

    if (!creds.project_id || !creds.private_key || !creds.client_email) {
      return res.status(400).json({
        valid: false,
        error: 'Invalid credentials format. Required fields: project_id, private_key, client_email',
      });
    }

    const client = createClient(creds);
    const location = 'asia-south1';
    const parent = `projects/${creds.project_id}/locations/${location}`;

    try {
      await client.listRepositories({ parent, pageSize: 1 }, { autoPaginate: false });
    } catch (e) {
      try {
        const parent2 = `projects/${creds.project_id}/locations/us-central1`;
        await client.listRepositories({ parent: parent2, pageSize: 1 }, { autoPaginate: false });
      } catch (e2) {
        if (e2.code === 16) {
          return res.json({ valid: false, error: 'Invalid credentials - authentication failed' });
        }
      }
    }

    res.json({
      valid: true,
      projectId: creds.project_id,
      serviceAccount: creds.client_email,
    });
  } catch (e) {
    res.status(400).json({ valid: false, error: 'Failed to validate: ' + e.message });
  }
});

app.post('/api/info', withCredentials, (req, res) => {
  res.json({
    projectId: req.gcpCredentials.project_id,
    serviceAccount: req.gcpCredentials.client_email,
  });
});

// ─── Repositories (lightweight list — no images/tags) ───────────────────────

app.post('/api/repositories', withCredentials, async (req, res) => {
  try {
    const { location, locations } = req.body;
    const locs = location
      ? [location]
      : Array.isArray(locations) && locations.length
        ? locations
        : DEFAULT_LOCATIONS;

    const results = await Promise.all(
      locs.map(async (loc) => {
        try {
          const parent = `projects/${req.gcpCredentials.project_id}/locations/${loc}`;
          // Repos per location are typically few; fetch with a reasonable cap
          const [repositories] = await req.gcpClient.listRepositories(
            { parent, pageSize: 100 },
            { autoPaginate: false }
          );
          return repositories || [];
        } catch {
          return [];
        }
      })
    );

    const allRepositories = results.flat();
    const formattedRepos = allRepositories
      .map(formatRepository)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

    res.json({
      repositories: formattedRepos,
      count: formattedRepos.length,
      locations: locs,
    });
  } catch (error) {
    console.error('Error fetching repositories:', error);
    res.status(500).json({ error: error.message, code: error.code });
  }
});

// Single repository metadata
app.post('/api/repositories/:location/:repository', withCredentials, async (req, res) => {
  try {
    const { location, repository } = req.params;
    const name = `projects/${req.gcpCredentials.project_id}/locations/${location}/repositories/${repository}`;
    const [repo] = await req.gcpClient.getRepository({ name });
    res.json({ repository: formatRepository(repo) });
  } catch (error) {
    console.error('Error fetching repository:', error);
    res.status(error.code === 5 ? 404 : 500).json({ error: error.message });
  }
});

// ─── Packages (paginated) ───────────────────────────────────────────────────

app.post('/api/repositories/:location/:repository/packages', withCredentials, async (req, res) => {
  try {
    const { location, repository } = req.params;
    const pageSize = parsePageSize(req.body.pageSize, 25);
    const pageToken = req.body.pageToken || undefined;
    const orderBy = req.body.orderBy || 'update_time desc';

    const parent = `projects/${req.gcpCredentials.project_id}/locations/${location}/repositories/${repository}`;
    const { items, nextPageToken } = await listPage(req.gcpClient, 'listPackages', {
      parent,
      pageSize,
      pageToken,
      orderBy,
    });

    res.json({
      packages: items.map(formatPackage),
      count: items.length,
      nextPageToken,
      pageSize,
    });
  } catch (error) {
    console.error('Error fetching packages:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Versions / tags (paginated) ────────────────────────────────────────────

app.post(
  '/api/repositories/:location/:repository/packages/:package/versions',
  withCredentials,
  async (req, res) => {
    try {
      const { location, repository } = req.params;
      const packageName = decodeURIComponent(req.params.package);
      const pageSize = parsePageSize(req.body.pageSize, 25);
      const pageToken = req.body.pageToken || undefined;
      const orderBy = req.body.orderBy || 'update_time desc';

      const parent = `projects/${req.gcpCredentials.project_id}/locations/${location}/repositories/${repository}/packages/${packageName}`;
      const { items, nextPageToken } = await listPage(req.gcpClient, 'listVersions', {
        parent,
        pageSize,
        pageToken,
        orderBy,
      });

      res.json({
        versions: items.map(formatVersion),
        count: items.length,
        nextPageToken,
        pageSize,
      });
    } catch (error) {
      console.error('Error fetching versions:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// ─── Docker images (paginated, newest first) ────────────────────────────────

app.post(
  '/api/repositories/:location/:repository/docker-images',
  withCredentials,
  async (req, res) => {
    try {
      const { location, repository } = req.params;
      const pageSize = parsePageSize(req.body.pageSize, 20, 100);
      const pageToken = req.body.pageToken || undefined;
      // Newest first so time-based browsing works
      const orderBy = req.body.orderBy || 'upload_time desc';
      // Optional client-side cutoff: stop including images older than this ISO date
      // (still returns nextPageToken if more exist; client decides whether to continue)
      const since = req.body.since ? new Date(req.body.since) : null;

      const parent = `projects/${req.gcpCredentials.project_id}/locations/${location}/repositories/${repository}`;

      const page = await listPage(req.gcpClient, 'listDockerImages', {
        parent,
        pageSize,
        pageToken,
        orderBy,
      });

      let images = page.items.map(formatDockerImage);

      // Always present newest-first to the client for time browsing
      images.sort((a, b) => {
        const ta = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
        const tb = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
        return tb - ta;
      });

      // If since is set, drop older items (newest-first walk)
      let reachedCutoff = false;
      if (since && !Number.isNaN(since.getTime())) {
        const filtered = [];
        for (const img of images) {
          if (!img.uploadedAt || new Date(img.uploadedAt) >= since) {
            filtered.push(img);
          } else {
            // Only treat as cutoff when server ordered by upload time;
            // otherwise keep scanning via next page (client may load more)
            if (!page.orderByFallback) {
              reachedCutoff = true;
              break;
            }
          }
        }
        if (!page.orderByFallback) {
          images = filtered;
        } else {
          images = images.filter(
            (img) => !img.uploadedAt || new Date(img.uploadedAt) >= since
          );
        }
      }

      res.json({
        images,
        count: images.length,
        nextPageToken: reachedCutoff ? null : page.nextPageToken,
        pageSize,
        orderBy: page.orderByFallback ? null : orderBy,
        since: since && !Number.isNaN(since.getTime()) ? since.toISOString() : null,
        reachedCutoff,
      });
    } catch (error) {
      console.error('Error fetching Docker images:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// ─── Docker Hub (already paginated) ─────────────────────────────────────────

app.get('/api/dockerhub/search', async (req, res) => {
  const { query, page = 1, pageSize = 25 } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'Query is required' });
  }

  try {
    const response = await fetch(
      `https://hub.docker.com/v2/search/repositories/?query=${encodeURIComponent(query)}&page=${page}&page_size=${pageSize}`
    );
    const data = await response.json();

    const results = (data.results || []).map((item) => ({
      name: item.repo_name,
      description: item.short_description || '',
      stars: item.star_count || 0,
      pulls: item.pull_count || 0,
      isOfficial: item.is_official || false,
      isAutomated: item.is_automated || false,
    }));

    res.json({
      results,
      count: data.count || 0,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
    });
  } catch (error) {
    console.error('Docker Hub search error:', error);
    res.status(500).json({ error: 'Failed to search Docker Hub' });
  }
});

app.get('/api/dockerhub/tags/:namespace/:repository', async (req, res) => {
  const { namespace, repository } = req.params;
  const { page = 1, pageSize = 25 } = req.query;

  try {
    const ns = namespace === '_' ? 'library' : namespace;
    const response = await fetch(
      `https://hub.docker.com/v2/repositories/${ns}/${repository}/tags/?page=${page}&page_size=${pageSize}`
    );
    const data = await response.json();

    const tags = (data.results || []).map((tag) => ({
      name: tag.name,
      size: tag.full_size || 0,
      sizeFormatted: formatSize(tag.full_size || 0),
      lastUpdated: tag.last_updated,
      digest: tag.digest,
    }));

    res.json({
      tags,
      count: data.count || 0,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      hasMore: Boolean(data.next),
    });
  } catch (error) {
    console.error('Docker Hub tags error:', error);
    res.status(500).json({ error: 'Failed to get tags' });
  }
});

app.get('/api/dockerhub/popular', (req, res) => {
  const popularImages = [
    { name: 'nginx', description: 'Official NGINX image', category: 'Web Server' },
    { name: 'redis', description: 'Redis in-memory data store', category: 'Database' },
    { name: 'postgres', description: 'PostgreSQL database', category: 'Database' },
    { name: 'mysql', description: 'MySQL database', category: 'Database' },
    { name: 'mongo', description: 'MongoDB document database', category: 'Database' },
    { name: 'node', description: 'Node.js runtime', category: 'Runtime' },
    { name: 'python', description: 'Python runtime', category: 'Runtime' },
    { name: 'openjdk', description: 'OpenJDK Java runtime', category: 'Runtime' },
    { name: 'golang', description: 'Go programming language', category: 'Runtime' },
    { name: 'alpine', description: 'Minimal Alpine Linux', category: 'Base OS' },
    { name: 'ubuntu', description: 'Ubuntu Linux', category: 'Base OS' },
    { name: 'debian', description: 'Debian Linux', category: 'Base OS' },
    { name: 'keycloak/keycloak', description: 'Keycloak identity management', category: 'Security' },
    { name: 'elasticsearch', description: 'Elasticsearch search engine', category: 'Search' },
    { name: 'rabbitmq', description: 'RabbitMQ message broker', category: 'Messaging' },
    { name: 'jenkins/jenkins', description: 'Jenkins CI/CD server', category: 'CI/CD' },
    { name: 'grafana/grafana', description: 'Grafana monitoring dashboard', category: 'Monitoring' },
    { name: 'prom/prometheus', description: 'Prometheus monitoring', category: 'Monitoring' },
  ];

  res.json({ images: popularImages });
});

app.post('/api/transfer-commands', (req, res) => {
  const { sourceImage, sourceTag, targetRepo, targetLocation, targetName, credentials } = req.body;

  if (!sourceImage || !targetRepo || !targetLocation || !credentials) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const creds = typeof credentials === 'string' ? JSON.parse(credentials) : credentials;
  const projectId = creds.project_id;

  const tag = sourceTag || 'latest';
  const imageName = targetName || sourceImage.split('/').pop();
  const registryHost = `${targetLocation}-docker.pkg.dev`;
  const targetPath = `${registryHost}/${projectId}/${targetRepo}/${imageName}:${tag}`;

  let pullPath = sourceImage;
  if (!sourceImage.includes('/') && !sourceImage.includes('.')) {
    pullPath = sourceImage;
  }

  res.json({
    steps: [
      {
        step: 1,
        title: 'Authenticate with GCP Artifact Registry',
        command: `gcloud auth configure-docker ${registryHost} --quiet`,
        description: 'Configure Docker to authenticate with your GCP registry',
      },
      {
        step: 2,
        title: 'Pull the source image',
        command: `docker pull ${pullPath}:${tag}`,
        description: `Pull ${sourceImage}:${tag} from the source registry`,
      },
      {
        step: 3,
        title: 'Tag for GCP Artifact Registry',
        command: `docker tag ${pullPath}:${tag} ${targetPath}`,
        description: 'Tag the image with your GCP registry path',
      },
      {
        step: 4,
        title: 'Push to GCP Artifact Registry',
        command: `docker push ${targetPath}`,
        description: 'Push the image to your GCP Artifact Registry',
      },
    ],
    summary: {
      source: `${pullPath}:${tag}`,
      target: targetPath,
    },
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`\n🚀 GCP Artifact Registry UI is running!`);
  console.log(`\n   Local:   http://localhost:${PORT}`);
  console.log(`\n   Press Ctrl+C to stop\n`);
});

export default app;
