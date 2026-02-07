# GCP Artifact Registry Setup on VM

This guide covers how to set up Google Cloud Platform (GCP) on a VM, authenticate, and list container images from Artifact Registry.

---

## Prerequisites

- A GCP project with Artifact Registry enabled
- A VM instance (Linux-based)
- Service account credentials (JSON key file) with appropriate permissions

### Required Permissions

Your service account needs these roles:
- `roles/artifactregistry.reader` - To list and pull images
- `roles/artifactregistry.writer` - To push images (optional)

---

## Step 1: Install Google Cloud SDK

### Option A: Using the Installation Script (Recommended)

```bash
# Download and run the installer
curl -O https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz

# Extract the archive
tar -xf google-cloud-cli-linux-x86_64.tar.gz

# Run the install script
./google-cloud-sdk/install.sh

# Initialize the SDK
./google-cloud-sdk/bin/gcloud init
```

### Option B: Using Package Manager (Debian/Ubuntu)

```bash
# Add the Cloud SDK distribution URI as a package source
echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | sudo tee -a /etc/apt/sources.list.d/google-cloud-sdk.list

# Import the Google Cloud public key
curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo apt-key --keyring /usr/share/keyrings/cloud.google.gpg add -

# Update and install the SDK
sudo apt-get update && sudo apt-get install google-cloud-sdk
```

### Verify Installation

```bash
gcloud --version
```

---

## Step 2: Authenticate with GCP

### Option A: Using Service Account Key File

1. **Copy your service account JSON key to the VM:**
   ```bash
   # Example using SCP from your local machine
   scp /path/to/gcp-creds.json user@vm-ip:/home/user/gcp-creds.json
   ```

2. **Activate the service account:**
   ```bash
   gcloud auth activate-service-account --key-file=/path/to/gcp-creds.json
   ```

3. **Set the project:**
   ```bash
   gcloud config set project YOUR_PROJECT_ID
   ```

### Option B: Using Application Default Credentials

```bash
# Set the environment variable pointing to your credentials
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/gcp-creds.json"

# Verify authentication
gcloud auth application-default print-access-token
```

### Verify Authentication

```bash
# Check current authenticated account
gcloud auth list

# Check current project configuration
gcloud config list
```

---

## Step 3: Configure Docker for Artifact Registry

### Install Docker (if not already installed)

```bash
# Update package index
sudo apt-get update

# Install Docker
sudo apt-get install docker.io -y

# Start Docker service
sudo systemctl start docker
sudo systemctl enable docker

# Add your user to the docker group (to run docker without sudo)
sudo usermod -aG docker $USER

# Log out and back in for group changes to take effect
```

### Configure Docker Authentication

```bash
# Configure Docker to authenticate with Artifact Registry
gcloud auth configure-docker REGION-docker.pkg.dev
```

Replace `REGION` with your Artifact Registry region (e.g., `us-central1`, `asia-south1`).

**Example:**
```bash
gcloud auth configure-docker asia-south1-docker.pkg.dev
```

This adds the Artifact Registry host to your Docker configuration, allowing Docker to use `gcloud` credentials.

---

## Step 4: List Images in Artifact Registry

### Using gcloud CLI

```bash
# List all repositories in your project
gcloud artifacts repositories list --location=REGION

# List all images in a specific repository
gcloud artifacts docker images list REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY_NAME

# List images with tags
gcloud artifacts docker images list REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY_NAME --include-tags
```

**Example:**
```bash
# List repositories in asia-south1
gcloud artifacts repositories list --location=asia-south1

# List all images in a repository
gcloud artifacts docker images list asia-south1-docker.pkg.dev/my-project/my-repo

# List with detailed output (includes digests and tags)
gcloud artifacts docker images list asia-south1-docker.pkg.dev/my-project/my-repo --include-tags --format="table(package,version,tags)"
```

### Using Docker CLI

```bash
# You can also use docker to interact with the registry
docker pull REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY_NAME/IMAGE_NAME:TAG
```

---

## Quick Reference Commands

| Command | Description |
|---------|-------------|
| `gcloud auth activate-service-account --key-file=KEY.json` | Authenticate with service account |
| `gcloud config set project PROJECT_ID` | Set active project |
| `gcloud auth configure-docker REGION-docker.pkg.dev` | Configure Docker auth |
| `gcloud artifacts repositories list --location=REGION` | List repositories |
| `gcloud artifacts docker images list REGISTRY_PATH` | List images |
| `gcloud auth list` | Show authenticated accounts |

---

## Troubleshooting

### Permission Denied Errors

```bash
# Verify your service account has the correct permissions
gcloud projects get-iam-policy PROJECT_ID --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:YOUR_SERVICE_ACCOUNT_EMAIL"
```

### Docker Authentication Issues

```bash
# Re-configure Docker authentication
gcloud auth configure-docker REGION-docker.pkg.dev --quiet

# Or use a credential helper directly
gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin https://REGION-docker.pkg.dev
```

### Check Artifact Registry API is Enabled

```bash
gcloud services enable artifactregistry.googleapis.com
```

---

## Environment Variables (Optional)

Add these to your `.bashrc` or `.profile` for convenience:

```bash
# Set default credentials
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/gcp-creds.json"

# Set default project
export CLOUDSDK_CORE_PROJECT="your-project-id"

# Set default region for Artifact Registry
export CLOUDSDK_ARTIFACTS_LOCATION="asia-south1"
```

---

## Security Best Practices

1. **Never commit credentials to version control** - Use `.gitignore` to exclude JSON key files
2. **Use least privilege** - Grant only necessary permissions to service accounts
3. **Rotate keys regularly** - Periodically generate new service account keys
4. **Consider Workload Identity** - For GKE workloads, use Workload Identity instead of key files
5. **Use Secret Manager** - Store credentials securely using GCP Secret Manager

---

## Additional Resources

- [Artifact Registry Documentation](https://cloud.google.com/artifact-registry/docs)
- [gcloud CLI Reference](https://cloud.google.com/sdk/gcloud/reference/artifacts)
- [Docker Authentication](https://cloud.google.com/artifact-registry/docs/docker/authentication)
