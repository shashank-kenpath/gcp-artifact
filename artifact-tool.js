#!/usr/bin/env node

import { ArtifactRegistryClient } from '@google-cloud/artifact-registry';
import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CREDENTIALS_PATH = path.join(__dirname, 'gcp-creds.json');
const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
const PROJECT_ID = credentials.project_id;

// Set environment variable for authentication
process.env.GOOGLE_APPLICATION_CREDENTIALS = CREDENTIALS_PATH;

// Initialize the Artifact Registry client
const client = new ArtifactRegistryClient({
  keyFilename: CREDENTIALS_PATH,
});

// Utility functions
function formatDate(timestamp) {
  if (!timestamp) return 'N/A';
  const date = new Date(timestamp.seconds * 1000);
  return date.toLocaleString();
}

function formatSize(bytes) {
  if (!bytes) return 'N/A';
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 Bytes';
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)), 10);
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

// ============== LIST REPOSITORIES ==============
async function listRepositories(location = '-') {
  const spinner = ora('Fetching repositories...').start();
  
  try {
    const parent = `projects/${PROJECT_ID}/locations/${location}`;
    const [repositories] = await client.listRepositories({ parent });
    
    spinner.succeed(chalk.green(`Found ${repositories.length} repositories`));
    
    if (repositories.length === 0) {
      console.log(chalk.yellow('\nNo repositories found.'));
      return [];
    }
    
    const table = new Table({
      head: [
        chalk.cyan('Name'),
        chalk.cyan('Format'),
        chalk.cyan('Location'),
        chalk.cyan('Description'),
        chalk.cyan('Created'),
      ],
      colWidths: [30, 12, 15, 30, 22],
    });
    
    repositories.forEach((repo) => {
      const nameParts = repo.name.split('/');
      const repoName = nameParts[nameParts.length - 1];
      const repoLocation = nameParts[3];
      
      table.push([
        repoName,
        repo.format || 'N/A',
        repoLocation,
        repo.description || 'N/A',
        formatDate(repo.createTime),
      ]);
    });
    
    console.log('\n' + table.toString());
    return repositories;
  } catch (error) {
    spinner.fail(chalk.red('Failed to fetch repositories'));
    console.error(chalk.red(`Error: ${error.message}`));
    if (error.code === 7) {
      console.log(chalk.yellow('\nPermission denied. Make sure the service account has Artifact Registry Reader role.'));
    }
    return [];
  }
}

// ============== LIST PACKAGES ==============
async function listPackages(repository, location) {
  const spinner = ora('Fetching packages...').start();
  
  try {
    const parent = `projects/${PROJECT_ID}/locations/${location}/repositories/${repository}`;
    const [packages] = await client.listPackages({ parent });
    
    spinner.succeed(chalk.green(`Found ${packages.length} packages in ${repository}`));
    
    if (packages.length === 0) {
      console.log(chalk.yellow('\nNo packages found in this repository.'));
      return [];
    }
    
    const table = new Table({
      head: [
        chalk.cyan('Package Name'),
        chalk.cyan('Created'),
        chalk.cyan('Updated'),
      ],
      colWidths: [50, 22, 22],
    });
    
    packages.forEach((pkg) => {
      const nameParts = pkg.name.split('/');
      const pkgName = nameParts[nameParts.length - 1];
      
      table.push([
        pkgName,
        formatDate(pkg.createTime),
        formatDate(pkg.updateTime),
      ]);
    });
    
    console.log('\n' + table.toString());
    return packages;
  } catch (error) {
    spinner.fail(chalk.red('Failed to fetch packages'));
    console.error(chalk.red(`Error: ${error.message}`));
    return [];
  }
}

// ============== LIST VERSIONS ==============
async function listVersions(repository, location, packageName) {
  const spinner = ora('Fetching versions...').start();
  
  try {
    const parent = `projects/${PROJECT_ID}/locations/${location}/repositories/${repository}/packages/${packageName}`;
    const [versions] = await client.listVersions({ parent });
    
    spinner.succeed(chalk.green(`Found ${versions.length} versions for ${packageName}`));
    
    if (versions.length === 0) {
      console.log(chalk.yellow('\nNo versions found for this package.'));
      return [];
    }
    
    const table = new Table({
      head: [
        chalk.cyan('Version'),
        chalk.cyan('Created'),
        chalk.cyan('Updated'),
        chalk.cyan('Description'),
      ],
      colWidths: [30, 22, 22, 30],
    });
    
    versions.forEach((version) => {
      const nameParts = version.name.split('/');
      const versionName = nameParts[nameParts.length - 1];
      
      table.push([
        versionName,
        formatDate(version.createTime),
        formatDate(version.updateTime),
        version.description || 'N/A',
      ]);
    });
    
    console.log('\n' + table.toString());
    return versions;
  } catch (error) {
    spinner.fail(chalk.red('Failed to fetch versions'));
    console.error(chalk.red(`Error: ${error.message}`));
    return [];
  }
}

// ============== LIST DOCKER IMAGES ==============
async function listDockerImages(repository, location) {
  const spinner = ora('Fetching Docker images...').start();
  
  try {
    const parent = `projects/${PROJECT_ID}/locations/${location}/repositories/${repository}`;
    const [images] = await client.listDockerImages({ parent });
    
    spinner.succeed(chalk.green(`Found ${images.length} Docker images`));
    
    if (images.length === 0) {
      console.log(chalk.yellow('\nNo Docker images found in this repository.'));
      return [];
    }
    
    const table = new Table({
      head: [
        chalk.cyan('Image'),
        chalk.cyan('Tags'),
        chalk.cyan('Size'),
        chalk.cyan('Uploaded'),
      ],
      colWidths: [45, 25, 12, 22],
    });
    
    images.forEach((image) => {
      const nameParts = image.name.split('/');
      const imageName = nameParts.slice(-2).join('/');
      const tags = image.tags?.join(', ') || 'untagged';
      
      table.push([
        imageName,
        tags.length > 23 ? tags.substring(0, 20) + '...' : tags,
        formatSize(Number(image.imageSizeBytes)),
        formatDate(image.uploadTime),
      ]);
    });
    
    console.log('\n' + table.toString());
    return images;
  } catch (error) {
    spinner.fail(chalk.red('Failed to fetch Docker images'));
    console.error(chalk.red(`Error: ${error.message}`));
    return [];
  }
}

// ============== DOWNLOAD ARTIFACT (using gcloud/docker) ==============
async function downloadArtifact(repository, location, format, options = {}) {
  const spinner = ora('Preparing download...').start();
  
  try {
    // First, authenticate with gcloud
    spinner.text = 'Authenticating with GCP...';
    
    const authCommand = `gcloud auth activate-service-account --key-file="${CREDENTIALS_PATH}"`;
    execSync(authCommand, { stdio: 'pipe' });
    
    const registryHost = `${location}-docker.pkg.dev`;
    
    if (format === 'DOCKER') {
      // Configure Docker to use gcloud credentials
      spinner.text = 'Configuring Docker authentication...';
      execSync(`gcloud auth configure-docker ${registryHost} --quiet`, { stdio: 'pipe' });
      
      spinner.succeed(chalk.green('Docker authentication configured'));
      
      // List available images
      const images = await listDockerImages(repository, location);
      if (images.length === 0) return;
      
      const choices = images.map((img) => {
        const nameParts = img.name.split('/');
        const imageName = nameParts.slice(-2).join('/').replace('/sha256:', '@sha256:');
        const tags = img.tags?.join(', ') || 'untagged';
        return {
          name: `${imageName} (${tags})`,
          value: img,
        };
      });
      
      const { selectedImage } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedImage',
          message: 'Select an image to pull:',
          choices,
        },
      ]);
      
      // Construct the full image path
      let imageUri = selectedImage.uri;
      if (selectedImage.tags && selectedImage.tags.length > 0) {
        // Use the first tag
        const baseUri = imageUri.split('@')[0];
        imageUri = `${baseUri}:${selectedImage.tags[0]}`;
      }
      
      console.log(chalk.blue(`\nPulling image: ${imageUri}`));
      
      const pullSpinner = ora('Pulling Docker image...').start();
      try {
        execSync(`docker pull ${imageUri}`, { stdio: 'inherit' });
        pullSpinner.succeed(chalk.green('Image pulled successfully!'));
      } catch (pullError) {
        pullSpinner.fail(chalk.red('Failed to pull image'));
        console.log(chalk.yellow('\nManual pull command:'));
        console.log(chalk.white(`docker pull ${imageUri}`));
      }
    } else {
      spinner.info(chalk.yellow(`Download for ${format} format - use the appropriate package manager`));
      
      console.log(chalk.blue('\nRepository URL:'));
      console.log(chalk.white(`${registryHost}/${PROJECT_ID}/${repository}`));
      
      if (format === 'NPM') {
        console.log(chalk.blue('\nTo configure npm:'));
        console.log(chalk.white(`npm config set @scope:registry https://${registryHost}/${PROJECT_ID}/${repository}/`));
      } else if (format === 'MAVEN') {
        console.log(chalk.blue('\nMaven repository URL:'));
        console.log(chalk.white(`https://${registryHost}/${PROJECT_ID}/${repository}`));
      } else if (format === 'PYTHON') {
        console.log(chalk.blue('\nPip install command:'));
        console.log(chalk.white(`pip install --extra-index-url https://${registryHost}/${PROJECT_ID}/${repository}/simple/ PACKAGE_NAME`));
      }
    }
  } catch (error) {
    spinner.fail(chalk.red('Download failed'));
    console.error(chalk.red(`Error: ${error.message}`));
    console.log(chalk.yellow('\nMake sure gcloud CLI is installed and in your PATH.'));
  }
}

// ============== UPLOAD ARTIFACT ==============
async function uploadArtifact(repository, location, format, artifactPath) {
  const spinner = ora('Preparing upload...').start();
  
  try {
    // Authenticate with gcloud
    spinner.text = 'Authenticating with GCP...';
    const authCommand = `gcloud auth activate-service-account --key-file="${CREDENTIALS_PATH}"`;
    execSync(authCommand, { stdio: 'pipe' });
    
    const registryHost = `${location}-docker.pkg.dev`;
    
    if (format === 'DOCKER') {
      // Configure Docker authentication
      spinner.text = 'Configuring Docker authentication...';
      execSync(`gcloud auth configure-docker ${registryHost} --quiet`, { stdio: 'pipe' });
      spinner.succeed(chalk.green('Docker authentication configured'));
      
      // Get image name and tag from user
      const { imageName, imageTag } = await inquirer.prompt([
        {
          type: 'input',
          name: 'imageName',
          message: 'Enter the image name:',
          validate: (input) => input.length > 0 || 'Image name is required',
        },
        {
          type: 'input',
          name: 'imageTag',
          message: 'Enter the tag (default: latest):',
          default: 'latest',
        },
      ]);
      
      const fullImagePath = `${registryHost}/${PROJECT_ID}/${repository}/${imageName}:${imageTag}`;
      
      if (artifactPath) {
        // Tag existing local image
        console.log(chalk.blue(`\nTagging local image ${artifactPath} as ${fullImagePath}`));
        execSync(`docker tag ${artifactPath} ${fullImagePath}`, { stdio: 'inherit' });
      }
      
      // Push the image
      console.log(chalk.blue(`\nPushing image to: ${fullImagePath}`));
      const pushSpinner = ora('Pushing Docker image...').start();
      try {
        execSync(`docker push ${fullImagePath}`, { stdio: 'inherit' });
        pushSpinner.succeed(chalk.green('Image pushed successfully!'));
      } catch (pushError) {
        pushSpinner.fail(chalk.red('Failed to push image'));
        console.log(chalk.yellow('\nManual push command:'));
        console.log(chalk.white(`docker push ${fullImagePath}`));
      }
    } else {
      spinner.info(chalk.yellow(`Upload for ${format} format - use the appropriate package manager`));
      
      console.log(chalk.blue('\nRepository URL:'));
      console.log(chalk.white(`${registryHost}/${PROJECT_ID}/${repository}`));
      
      if (format === 'NPM') {
        console.log(chalk.blue('\nTo publish npm package:'));
        console.log(chalk.white(`npm publish --registry=https://${registryHost}/${PROJECT_ID}/${repository}/`));
      } else if (format === 'PYTHON') {
        console.log(chalk.blue('\nTo upload Python package:'));
        console.log(chalk.white(`twine upload --repository-url https://${registryHost}/${PROJECT_ID}/${repository}/ dist/*`));
      }
    }
  } catch (error) {
    spinner.fail(chalk.red('Upload failed'));
    console.error(chalk.red(`Error: ${error.message}`));
    console.log(chalk.yellow('\nMake sure gcloud CLI and Docker are installed and in your PATH.'));
  }
}

// ============== INTERACTIVE MODE ==============
async function interactiveMode() {
  console.log(chalk.blue.bold('\n🚀 GCP Artifact Registry Tool\n'));
  console.log(chalk.gray(`Project: ${PROJECT_ID}`));
  console.log(chalk.gray(`Credentials: ${CREDENTIALS_PATH}\n`));
  
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: '📋 List Repositories', value: 'list-repos' },
        { name: '📦 List Packages in Repository', value: 'list-packages' },
        { name: '🐳 List Docker Images', value: 'list-docker' },
        { name: '📥 Download Artifact', value: 'download' },
        { name: '📤 Upload Artifact', value: 'upload' },
        { name: '🚪 Exit', value: 'exit' },
      ],
    },
  ]);
  
  if (action === 'exit') {
    console.log(chalk.green('\nGoodbye! 👋\n'));
    process.exit(0);
  }
  
  if (action === 'list-repos') {
    const { location } = await inquirer.prompt([
      {
        type: 'input',
        name: 'location',
        message: 'Enter location (or "-" for all locations):',
        default: '-',
      },
    ]);
    await listRepositories(location);
  } else if (action === 'list-packages') {
    const repos = await listRepositories();
    if (repos.length > 0) {
      const { selectedRepo } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedRepo',
          message: 'Select a repository:',
          choices: repos.map((r) => {
            const parts = r.name.split('/');
            return {
              name: `${parts[parts.length - 1]} (${parts[3]})`,
              value: { name: parts[parts.length - 1], location: parts[3] },
            };
          }),
        },
      ]);
      await listPackages(selectedRepo.name, selectedRepo.location);
    }
  } else if (action === 'list-docker') {
    const repos = await listRepositories();
    const dockerRepos = repos.filter((r) => r.format === 'DOCKER');
    if (dockerRepos.length > 0) {
      const { selectedRepo } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedRepo',
          message: 'Select a Docker repository:',
          choices: dockerRepos.map((r) => {
            const parts = r.name.split('/');
            return {
              name: `${parts[parts.length - 1]} (${parts[3]})`,
              value: { name: parts[parts.length - 1], location: parts[3] },
            };
          }),
        },
      ]);
      await listDockerImages(selectedRepo.name, selectedRepo.location);
    } else {
      console.log(chalk.yellow('\nNo Docker repositories found.'));
    }
  } else if (action === 'download') {
    const repos = await listRepositories();
    if (repos.length > 0) {
      const { selectedRepo } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedRepo',
          message: 'Select a repository:',
          choices: repos.map((r) => {
            const parts = r.name.split('/');
            return {
              name: `${parts[parts.length - 1]} (${r.format}, ${parts[3]})`,
              value: { name: parts[parts.length - 1], location: parts[3], format: r.format },
            };
          }),
        },
      ]);
      await downloadArtifact(selectedRepo.name, selectedRepo.location, selectedRepo.format);
    }
  } else if (action === 'upload') {
    const repos = await listRepositories();
    if (repos.length > 0) {
      const { selectedRepo } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedRepo',
          message: 'Select a repository:',
          choices: repos.map((r) => {
            const parts = r.name.split('/');
            return {
              name: `${parts[parts.length - 1]} (${r.format}, ${parts[3]})`,
              value: { name: parts[parts.length - 1], location: parts[3], format: r.format },
            };
          }),
        },
      ]);
      
      let artifactPath = null;
      if (selectedRepo.format === 'DOCKER') {
        const { localImage } = await inquirer.prompt([
          {
            type: 'input',
            name: 'localImage',
            message: 'Enter local image name to push (or leave empty to just configure):',
          },
        ]);
        artifactPath = localImage || null;
      }
      
      await uploadArtifact(selectedRepo.name, selectedRepo.location, selectedRepo.format, artifactPath);
    }
  }
  
  // Continue interactive mode
  const { continueAction } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'continueAction',
      message: 'Would you like to perform another action?',
      default: true,
    },
  ]);
  
  if (continueAction) {
    await interactiveMode();
  } else {
    console.log(chalk.green('\nGoodbye! 👋\n'));
  }
}

// ============== CLI COMMANDS ==============
program
  .name('gcp-artifact')
  .description(chalk.blue('CLI tool for managing GCP Artifact Registry'))
  .version('1.0.0');

program
  .command('list')
  .alias('ls')
  .description('List all repositories')
  .option('-l, --location <location>', 'GCP location (e.g., us-central1, asia-south1)', '-')
  .action(async (options) => {
    await listRepositories(options.location);
  });

program
  .command('packages <repository>')
  .alias('pkg')
  .description('List packages in a repository')
  .option('-l, --location <location>', 'GCP location', 'us-central1')
  .action(async (repository, options) => {
    await listPackages(repository, options.location);
  });

program
  .command('versions <repository> <package>')
  .alias('ver')
  .description('List versions of a package')
  .option('-l, --location <location>', 'GCP location', 'us-central1')
  .action(async (repository, packageName, options) => {
    await listVersions(repository, options.location, packageName);
  });

program
  .command('docker <repository>')
  .description('List Docker images in a repository')
  .option('-l, --location <location>', 'GCP location', 'us-central1')
  .action(async (repository, options) => {
    await listDockerImages(repository, options.location);
  });

program
  .command('pull <repository>')
  .description('Pull/download a Docker image')
  .option('-l, --location <location>', 'GCP location', 'us-central1')
  .action(async (repository, options) => {
    await downloadArtifact(repository, options.location, 'DOCKER');
  });

program
  .command('push <repository>')
  .description('Push/upload a Docker image')
  .option('-l, --location <location>', 'GCP location', 'us-central1')
  .option('-i, --image <image>', 'Local Docker image to push')
  .action(async (repository, options) => {
    await uploadArtifact(repository, options.location, 'DOCKER', options.image);
  });

program
  .command('interactive')
  .alias('i')
  .description('Start interactive mode')
  .action(async () => {
    await interactiveMode();
  });

// Default to interactive mode if no command specified
if (process.argv.length <= 2) {
  interactiveMode();
} else {
  program.parse();
}
