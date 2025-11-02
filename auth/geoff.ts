#!/usr/bin/env bun

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const VERSION = '1.0.0';
const CONFIG_DIR = join(homedir(), '.config', 'geoff-cli');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const DEFAULT_BASE_URL = 'https://geoff.seemueller.io';

interface Config {
  apiKey?: string;
  baseUrl?: string;
}

// Ensure config directory exists
function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

// Load configuration
function loadConfig(): Config {
  ensureConfigDir();
  if (!existsSync(CONFIG_FILE)) {
    return {};
  }
  try {
    const content = readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Error reading config file:', error);
    return {};
  }
}

// Save configuration
function saveConfig(config: Config) {
  ensureConfigDir();
  try {
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error writing config file:', error);
    process.exit(1);
  }
}

// Get base URL from config or use default
function getBaseUrl(): string {
  const config = loadConfig();
  return config.baseUrl || DEFAULT_BASE_URL;
}

// Print help message
function printHelp() {
  console.log(`
Geoff CLI - Command line interface for geoff.seemueller.io

Usage: geoff <command> [options]

Commands:
  auth login               Authenticate and generate an API key
  auth logout              Remove stored credentials
  auth status              Check authentication status
  keys list                List all your API keys
  keys revoke <id>         Revoke an API key by ID
  config set-url <url>     Set the base URL for the API
  version                  Show version information
  help                     Show this help message

Examples:
  geoff auth login
  geoff auth status
  geoff keys list
  geoff keys revoke abc123
  geoff config set-url https://custom.example.com
`);
}

// Print version
function printVersion() {
  console.log(`Geoff CLI v${VERSION}`);
}

// Check authentication status
function checkAuthStatus() {
  const config = loadConfig();
  const baseUrl = getBaseUrl();

  console.log(`Base URL: ${baseUrl}`);

  if (config.apiKey) {
    console.log('Status: Authenticated ✓');
    console.log(`API Key: ${config.apiKey.substring(0, 20)}...`);
  } else {
    console.log('Status: Not authenticated ✗');
    console.log('\nRun "geoff auth login" to authenticate');
  }
}

// Login with username and password
async function login() {
  const baseUrl = getBaseUrl();

  console.log(`Authenticating to ${baseUrl}...\n`);

  // Prompt for username/email
  const username = await promptInput('Email or username: ');
  if (!username) {
    console.error('Error: Email/username is required');
    process.exit(1);
  }

  // Prompt for password (hidden input)
  const password = await promptPassword('Password: ');
  if (!password) {
    console.error('Error: Password is required');
    process.exit(1);
  }

  try {
    // Authenticate with the server
    console.log('\nAuthenticating...');
    const loginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: username, password }),
    });

    if (!loginResponse.ok) {
      const errorText = await loginResponse.text();
      console.error(`Authentication failed: ${errorText}`);
      process.exit(1);
    }

    // Extract cookies from login response
    const cookies = loginResponse.headers.get('set-cookie') || '';

    // Generate API key
    console.log('Generating API key...');
    const keyName = `cli-${new Date().toISOString().split('T')[0]}`;
    const generateResponse = await fetch(`${baseUrl}/api/keys/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookies,
      },
      body: JSON.stringify({
        name: keyName,
        expiresInDays: 90,
      }),
    });

    if (!generateResponse.ok) {
      const errorText = await generateResponse.text();
      console.error(`Failed to generate API key: ${errorText}`);
      process.exit(1);
    }

    const result = await generateResponse.json();

    if (!result.apiKey?.key) {
      console.error('Failed to generate API key: Invalid response from server');
      process.exit(1);
    }

    // Save API key to config
    const config = loadConfig();
    config.apiKey = result.apiKey.key;
    saveConfig(config);

    console.log('\n✓ Authentication successful!');
    console.log(`API Key: ${result.apiKey.key}`);
    console.log('\nYour API key has been saved to:', CONFIG_FILE);
    console.log('\n⚠️  Keep this key secure and do not share it with others.');
    if (result.apiKey.expiresAt) {
      const expiresDate = new Date(result.apiKey.expiresAt);
      console.log(`\nKey expires: ${expiresDate.toLocaleDateString()}`);
    }
  } catch (error: any) {
    console.error('Error during authentication:', error.message);
    process.exit(1);
  }
}

// Logout (remove credentials)
function logout() {
  const config = loadConfig();
  if (!config.apiKey) {
    console.log('Already logged out');
    return;
  }

  delete config.apiKey;
  saveConfig(config);
  console.log('✓ Logged out successfully');
}

// List API keys
async function listKeys() {
  const config = loadConfig();
  const baseUrl = getBaseUrl();

  if (!config.apiKey) {
    console.error('Error: Not authenticated. Run "geoff auth login" first.');
    process.exit(1);
  }

  try {
    const response = await fetch(`${baseUrl}/api/keys`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to list keys: ${errorText}`);
      process.exit(1);
    }

    const result = await response.json();

    if (!result.keys || result.keys.length === 0) {
      console.log('No API keys found');
      return;
    }

    console.log(`\nYour API Keys:\n`);
    for (const key of result.keys) {
      console.log(`ID: ${key.id}`);
      console.log(`Name: ${key.name}`);
      console.log(`Created: ${new Date(key.created).toLocaleString()}`);
      if (key.lastUsed) {
        console.log(`Last Used: ${new Date(key.lastUsed).toLocaleString()}`);
      }
      if (key.expiresAt) {
        console.log(`Expires: ${new Date(key.expiresAt).toLocaleString()}`);
      }
      console.log('');
    }
  } catch (error: any) {
    console.error('Error listing keys:', error.message);
    process.exit(1);
  }
}

// Revoke an API key
async function revokeKey(keyId: string) {
  const config = loadConfig();
  const baseUrl = getBaseUrl();

  if (!config.apiKey) {
    console.error('Error: Not authenticated. Run "geoff auth login" first.');
    process.exit(1);
  }

  if (!keyId) {
    console.error('Error: Key ID is required');
    console.log('Usage: geoff keys revoke <id>');
    process.exit(1);
  }

  try {
    const response = await fetch(`${baseUrl}/api/keys/${keyId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to revoke key: ${errorText}`);
      process.exit(1);
    }

    const result = await response.json();
    console.log(`✓ ${result.message || 'API key revoked successfully'}`);
  } catch (error: any) {
    console.error('Error revoking key:', error.message);
    process.exit(1);
  }
}

// Set base URL
function setBaseUrl(url: string) {
  if (!url) {
    console.error('Error: URL is required');
    console.log('Usage: geoff config set-url <url>');
    process.exit(1);
  }

  try {
    new URL(url); // Validate URL
  } catch {
    console.error('Error: Invalid URL format');
    process.exit(1);
  }

  const config = loadConfig();
  config.baseUrl = url;
  saveConfig(config);

  console.log(`✓ Base URL set to: ${url}`);
}

// Helper: Prompt for input
async function promptInput(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    process.stdin.once('data', (data) => {
      resolve(data.toString().trim());
    });
  });
}

// Helper: Prompt for password (hidden input)
async function promptPassword(prompt: string): Promise<string> {
  process.stdout.write(prompt);

  // Disable echo for password input
  process.stdin.setRawMode(true);

  return new Promise((resolve) => {
    let password = '';

    const onData = (char: Buffer) => {
      const byte = char[0];

      if (byte === 13 || byte === 10) {
        // Enter key
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(password);
      } else if (byte === 127 || byte === 8) {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (byte === 3) {
        // Ctrl+C
        process.stdin.setRawMode(false);
        process.stdout.write('\n');
        process.exit(1);
      } else {
        password += char.toString();
        process.stdout.write('*');
      }
    };

    process.stdin.on('data', onData);
  });
}

// Main CLI handler
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help') {
    printHelp();
    return;
  }

  const command = args[0];
  const subcommand = args[1];

  switch (command) {
    case 'version':
      printVersion();
      break;

    case 'auth':
      if (subcommand === 'login') {
        await login();
      } else if (subcommand === 'logout') {
        logout();
      } else if (subcommand === 'status') {
        checkAuthStatus();
      } else {
        console.error(`Unknown auth subcommand: ${subcommand}`);
        console.log('Available: login, logout, status');
        process.exit(1);
      }
      break;

    case 'keys':
      if (subcommand === 'list') {
        await listKeys();
      } else if (subcommand === 'revoke') {
        const keyId = args[2];
        await revokeKey(keyId);
      } else {
        console.error(`Unknown keys subcommand: ${subcommand}`);
        console.log('Available: list, revoke <id>');
        process.exit(1);
      }
      break;

    case 'config':
      if (subcommand === 'set-url') {
        const url = args[2];
        setBaseUrl(url);
      } else {
        console.error(`Unknown config subcommand: ${subcommand}`);
        console.log('Available: set-url <url>');
        process.exit(1);
      }
      break;

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

// Run the CLI
main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});