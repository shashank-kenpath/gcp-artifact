import express from 'express';
import cors from 'cors';
import { ArtifactRegistryClient } from '@google-cloud/artifact-registry';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Utility functions
function formatDate(timestamp) {
    if (!timestamp) return null;
    return new Date(timestamp.seconds * 1000).toISOString();
}

function formatSize(bytes) {
    if (!bytes) return 'N/A';
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)), 10);
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

// Helper to create GCP client from credentials object
function createClient(credentials) {
    return new ArtifactRegistryClient({
        credentials: {
            client_email: credentials.client_email,
            private_key: credentials.private_key,
        },
        projectId: credentials.project_id,
    });
}

// Middleware to extract and validate credentials from request
function withCredentials(req, res, next) {
    const credentials = req.body.credentials || req.query.credentials;

    if (!credentials) {
        return res.status(401).json({
            error: 'No credentials provided',
            requiresAuth: true
        });
    }

    try {
        const creds = typeof credentials === 'string' ? JSON.parse(credentials) : credentials;

        if (!creds.project_id || !creds.private_key || !creds.client_email) {
            return res.status(400).json({
                error: 'Invalid credentials format. Required: project_id, private_key, client_email',
                requiresAuth: true
            });
        }

        req.gcpCredentials = creds;
        req.gcpClient = createClient(creds);
        next();
    } catch (e) {
        return res.status(400).json({
            error: 'Failed to parse credentials: ' + e.message,
            requiresAuth: true
        });
    }
}

// API Routes

// Validate credentials
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
                error: 'Invalid credentials format. Required fields: project_id, private_key, client_email'
            });
        }

        // Try to create client and make a simple API call to validate
        const client = createClient(creds);
        const location = 'asia-south1';
        const parent = `projects/${creds.project_id}/locations/${location}`;

        try {
            await client.listRepositories({ parent });
        } catch (e) {
            // Try another common location if asia-south1 fails
            try {
                const parent2 = `projects/${creds.project_id}/locations/us-central1`;
                await client.listRepositories({ parent: parent2 });
            } catch (e2) {
                // Even if no repos exist, authentication succeeded if we got here without auth error
                if (e2.code === 7 || e2.code === 3) {
                    // Permission denied or invalid argument - but authenticated
                    console.log('Credentials valid, but limited permissions');
                } else if (e2.code === 16) {
                    return res.json({ valid: false, error: 'Invalid credentials - authentication failed' });
                }
            }
        }

        res.json({
            valid: true,
            projectId: creds.project_id,
            serviceAccount: creds.client_email
        });
    } catch (e) {
        res.status(400).json({ valid: false, error: 'Failed to validate: ' + e.message });
    }
});

// Get project info (POST to receive credentials)
app.post('/api/info', withCredentials, (req, res) => {
    res.json({
        projectId: req.gcpCredentials.project_id,
        serviceAccount: req.gcpCredentials.client_email,
    });
});

// List all repositories
app.post('/api/repositories', withCredentials, async (req, res) => {
    try {
        const locations = ['asia-south1', 'us-central1', 'us-east1', 'europe-west1', 'asia-southeast1'];
        let allRepositories = [];

        for (const location of locations) {
            try {
                const parent = `projects/${req.gcpCredentials.project_id}/locations/${location}`;
                const [repositories] = await req.gcpClient.listRepositories({ parent });
                allRepositories = allRepositories.concat(repositories);
            } catch (e) {
                console.log(`No repositories in ${location} or access denied`);
            }
        }

        const formattedRepos = allRepositories.map((repo) => {
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
        });

        res.json({ repositories: formattedRepos, count: formattedRepos.length });
    } catch (error) {
        console.error('Error fetching repositories:', error);
        res.status(500).json({ error: error.message, code: error.code });
    }
});

// List packages in a repository
app.post('/api/repositories/:location/:repository/packages', withCredentials, async (req, res) => {
    try {
        const { location, repository } = req.params;
        const parent = `projects/${req.gcpCredentials.project_id}/locations/${location}/repositories/${repository}`;
        const [packages] = await req.gcpClient.listPackages({ parent });

        const formattedPackages = packages.map((pkg) => {
            const nameParts = pkg.name.split('/');
            return {
                id: pkg.name,
                name: nameParts[nameParts.length - 1],
                displayName: pkg.displayName || nameParts[nameParts.length - 1],
                createdAt: formatDate(pkg.createTime),
                updatedAt: formatDate(pkg.updateTime),
            };
        });

        res.json({ packages: formattedPackages, count: formattedPackages.length });
    } catch (error) {
        console.error('Error fetching packages:', error);
        res.status(500).json({ error: error.message });
    }
});

// List versions of a package
app.post('/api/repositories/:location/:repository/packages/:package/versions', withCredentials, async (req, res) => {
    try {
        const { location, repository } = req.params;
        const packageName = req.params.package;
        const parent = `projects/${req.gcpCredentials.project_id}/locations/${location}/repositories/${repository}/packages/${packageName}`;
        const [versions] = await req.gcpClient.listVersions({ parent });

        const formattedVersions = versions.map((version) => {
            const nameParts = version.name.split('/');
            return {
                id: version.name,
                name: nameParts[nameParts.length - 1],
                description: version.description || '',
                createdAt: formatDate(version.createTime),
                updatedAt: formatDate(version.updateTime),
                metadata: version.metadata || {},
            };
        });

        res.json({ versions: formattedVersions, count: formattedVersions.length });
    } catch (error) {
        console.error('Error fetching versions:', error);
        res.status(500).json({ error: error.message });
    }
});

// List Docker images in a repository
app.post('/api/repositories/:location/:repository/docker-images', withCredentials, async (req, res) => {
    try {
        const { location, repository } = req.params;
        const parent = `projects/${req.gcpCredentials.project_id}/locations/${location}/repositories/${repository}`;
        const [images] = await req.gcpClient.listDockerImages({ parent });

        const formattedImages = images.map((image) => {
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
        });

        res.json({ images: formattedImages, count: formattedImages.length });
    } catch (error) {
        console.error('Error fetching Docker images:', error);
        res.status(500).json({ error: error.message });
    }
});

// Search Docker Hub images (no auth required - public API)
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

        const results = (data.results || []).map(item => ({
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
            page: parseInt(page),
            pageSize: parseInt(pageSize),
        });
    } catch (error) {
        console.error('Docker Hub search error:', error);
        res.status(500).json({ error: 'Failed to search Docker Hub' });
    }
});

// Get Docker Hub image tags (no auth required - public API)
app.get('/api/dockerhub/tags/:namespace/:repository', async (req, res) => {
    const { namespace, repository } = req.params;
    const { page = 1, pageSize = 25 } = req.query;

    try {
        const ns = namespace === '_' ? 'library' : namespace;
        const response = await fetch(
            `https://hub.docker.com/v2/repositories/${ns}/${repository}/tags/?page=${page}&page_size=${pageSize}`
        );
        const data = await response.json();

        const tags = (data.results || []).map(tag => ({
            name: tag.name,
            size: tag.full_size || 0,
            sizeFormatted: formatSize(tag.full_size || 0),
            lastUpdated: tag.last_updated,
            digest: tag.digest,
        }));

        res.json({
            tags,
            count: data.count || 0,
            page: parseInt(page),
        });
    } catch (error) {
        console.error('Docker Hub tags error:', error);
        res.status(500).json({ error: 'Failed to get tags' });
    }
});

// Get popular Docker images (no auth required)
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

// Generate transfer commands (requires credentials for project ID)
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

// Serve the frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check for Vercel
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`\n🚀 GCP Artifact Registry UI is running!`);
    console.log(`\n   Local:   http://localhost:${PORT}`);
    console.log(`\n   Press Ctrl+C to stop\n`);
});

export default app;
